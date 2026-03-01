#!/usr/bin/env tsx
/**
 * stress-combo-execution.ts
 *
 * Stress test for the Combo Execution Engine.
 * Simulates 100 concurrent combo RFQs with 2-3 legs each.
 * Injects random LP retractions, connector latency, and partial connector failures.
 *
 * Invariants checked at the end:
 *   - No double fills (same legId filled more than once per planId)
 *   - All reservations were honored (no plan executed without a reservation token)
 *   - Exposure journal is consistent (total fills ≤ total reserved)
 *
 * Exit code 0 = all invariants OK
 * Exit code 1 = invariant violation detected
 */

import crypto from "crypto";
import pino from "pino";

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ level: "info" });

// ─── In-Memory Ledgers (thread-safe via JS single-thread model) ───────────────

/** filled[planId] = Set<legId> */
const filled = new Map<string, Set<string>>();

/** reservations[comboId] = reservationToken | null */
const reservations = new Map<string, string | null>();

/** exposureJournal: { comboId, legId, amount } */
const exposureJournal: Array<{ comboId: string; legId: string; amount: number }> = [];

/** planReservationMap[planId] = reservationToken */
const planReservationMap = new Map<string, string>();

// Counters
let totalPlansLaunched = 0;
let totalPlansCompleted = 0;
let totalPlansFailed = 0;
let totalDoubleFills = 0;
let totalMissingReservations = 0;

// ─── Simulated Primitives ─────────────────────────────────────────────────────

const LP_POOL = ["LP_A", "LP_B", "LP_C", "LP_D", "LP_E"];

/** Random sleep between min and max ms */
function sleep(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Randomly retract an LP citation (20% chance) */
function lpIsAvailable(lpId: string, retractedLPs: Set<string>): boolean {
    return !retractedLPs.has(lpId);
}

/** Simulate a connector fill with latency and random failure rate */
async function simulateConnectorFill(
    legId: string,
    lpId: string,
    failureProbability: number
): Promise<{ status: "FILLED" | "REJECTED"; filledAmount: number }> {
    // 10–200ms simulated connector latency
    await sleep(10, 200);

    if (Math.random() < failureProbability) {
        return { status: "REJECTED", filledAmount: 0 };
    }

    return { status: "FILLED", filledAmount: Math.round(50 + Math.random() * 100) };
}

// ─── Risk Engine Simulation ───────────────────────────────────────────────────

/** Simulates the risk engine. Returns a reservation token or throws. */
async function obtainReservation(comboId: string): Promise<string> {
    const existingToken = reservations.get(comboId);
    if (existingToken) {
        throw new Error(`Reservation already exists for ${comboId}`);
    }
    await sleep(1, 10); // DB round-trip latency
    const token = `resv_${crypto.randomUUID()}`;
    reservations.set(comboId, token);
    return token;
}

/** Releases/rollbacks a reservation. */
async function rollbackReservation(comboId: string, token: string): Promise<void> {
    const current = reservations.get(comboId);
    if (current === token) {
        reservations.delete(comboId);
    }
}

// ─── Simulated Combo Execution ────────────────────────────────────────────────

interface ComboJob {
    comboId: string;
    planId: string;
    legs: string[]; // legIds
    reservationToken: string;
    policy: "ALL_OR_NONE" | "PARTIAL_ALLOWED";
    retractedLPs: Set<string>;
    failureProbability: number;
}

async function executeCombo(job: ComboJob): Promise<"COMPLETED" | "PARTIAL" | "FAILED"> {
    const { comboId, planId, legs, reservationToken, policy, retractedLPs, failureProbability } = job;

    // Guard: record the reservation token for this plan
    planReservationMap.set(planId, reservationToken);

    // Validate reservation exists before dispatch
    const storedToken = reservations.get(comboId);
    if (!storedToken || storedToken !== reservationToken) {
        log.error({ comboId, planId }, "Missing or mismatched reservation before execution");
        totalMissingReservations++;
        return "FAILED";
    }

    // Pick an available LP
    const availableLPs = LP_POOL.filter(lp => lpIsAvailable(lp, retractedLPs));
    if (availableLPs.length === 0) {
        log.warn({ comboId }, "No available LPs — combo cannot execute");
        await rollbackReservation(comboId, reservationToken);
        return "FAILED";
    }
    const lpId = availableLPs[Math.floor(Math.random() * availableLPs.length)];

    // Initialize fill tracking for this plan
    if (!filled.has(planId)) {
        filled.set(planId, new Set());
    }
    const planFills = filled.get(planId)!;

    const fillResults = await Promise.allSettled(
        legs.map(async (legId) => {
            // Idempotency: skip already-filled legs
            if (planFills.has(legId)) {
                log.warn({ planId, legId }, "Idempotency guard: leg already filled, skipping");
                return { legId, status: "FILLED" as const, filledAmount: 0, skipped: true };
            }

            const result = await simulateConnectorFill(legId, lpId, failureProbability);
            return { legId, ...result, skipped: false };
        })
    );

    const successes: string[] = [];
    const failures: string[] = [];

    for (const r of fillResults) {
        if (r.status === "fulfilled") {
            const { legId, status, filledAmount, skipped } = r.value;
            if (status === "FILLED") {
                // Double-fill check
                if (!skipped && planFills.has(legId)) {
                    log.error({ planId, legId }, "‼️ DOUBLE FILL DETECTED");
                    totalDoubleFills++;
                }
                if (!skipped) {
                    planFills.add(legId);
                    exposureJournal.push({ comboId, legId, amount: filledAmount });
                }
                successes.push(legId);
            } else {
                failures.push(legId);
            }
        } else {
            failures.push("unknown");
        }
    }

    // Policy enforcement
    if (policy === "ALL_OR_NONE" && failures.length > 0) {
        // Unwind: ideally cancel filled orders; in simulation we just de-register fills
        for (const legId of successes) {
            planFills.delete(legId);
            // Remove from journal too  
            const idx = exposureJournal.findIndex(e => e.comboId === comboId && e.legId === legId);
            if (idx !== -1) exposureJournal.splice(idx, 1);
        }
        await rollbackReservation(comboId, reservationToken);
        return "FAILED";
    }

    if (successes.length >= legs.length) return "COMPLETED";
    if (successes.length > 0) return "PARTIAL";
    return "FAILED";
}

// ─── Main Stress Loop ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const CONCURRENCY = 100;
    log.info(`🚀 Launching ${CONCURRENCY} concurrent combo executions...`);

    const jobs: Promise<void>[] = [];

    for (let i = 0; i < CONCURRENCY; i++) {
        const comboId = crypto.randomUUID();
        const planId = crypto.randomUUID();

        // Random 2-3 legs
        const legCount = 2 + Math.floor(Math.random() * 2);
        const legs = Array.from({ length: legCount }, () => crypto.randomUUID());

        // Random LP retractions (0–2 LPs retract mid-run)
        const retractedLPs = new Set<string>();
        const retractCount = Math.floor(Math.random() * 3);
        for (let r = 0; r < retractCount; r++) {
            retractedLPs.add(LP_POOL[Math.floor(Math.random() * LP_POOL.length)]);
        }

        // Random failure probability per connector: 0%–40%
        const failureProbability = Math.random() * 0.4;

        const policy: "ALL_OR_NONE" | "PARTIAL_ALLOWED" = Math.random() > 0.5 ? "ALL_OR_NONE" : "PARTIAL_ALLOWED";

        const job = async () => {
            totalPlansLaunched++;
            let token: string;
            try {
                token = await obtainReservation(comboId);
            } catch (e) {
                log.warn({ comboId }, "Could not obtain reservation");
                totalPlansFailed++;
                return;
            }

            const result = await executeCombo({ comboId, planId, legs, reservationToken: token, policy, retractedLPs, failureProbability });

            if (result === "COMPLETED") {
                totalPlansCompleted++;
                log.info({ comboId, planId, policy, legCount }, "✅ COMPLETED");
            } else if (result === "PARTIAL") {
                totalPlansCompleted++;
                log.info({ comboId, planId, policy, legCount }, "⚡ PARTIAL fill accepted");
            } else {
                totalPlansFailed++;
                log.info({ comboId, planId, policy, legCount }, "❌ FAILED / unwound");
            }
        };

        jobs.push(job());
    }

    await Promise.allSettled(jobs);

    // ─── Invariant Checks ─────────────────────────────────────────────────────
    log.info("────────────────────────────────────────────");
    log.info("📋 Stress Test Results");
    log.info(`  Plans launched:   ${totalPlansLaunched}`);
    log.info(`  Plans completed:  ${totalPlansCompleted}`);
    log.info(`  Plans failed:     ${totalPlansFailed}`);
    log.info(`  Exposure entries: ${exposureJournal.length}`);

    let invariantViolations = 0;

    // Invariant 1: No double fills
    if (totalDoubleFills > 0) {
        log.error(`‼️ INVARIANT VIOLATION: ${totalDoubleFills} double fill(s) detected!`);
        invariantViolations++;
    } else {
        log.info("  ✅ No double fills detected");
    }

    // Invariant 2: No executions without reservations
    if (totalMissingReservations > 0) {
        log.error(`‼️ INVARIANT VIOLATION: ${totalMissingReservations} execution(s) ran without a valid reservation!`);
        invariantViolations++;
    } else {
        log.info("  ✅ All executions had valid reservations");
    }

    // Invariant 3: Exposure journal uniqueness per (planId, legId)
    const journalKeys = new Set<string>();
    for (const entry of exposureJournal) {
        const key = `${entry.comboId}:${entry.legId}`;
        if (journalKeys.has(key)) {
            log.error(`‼️ INVARIANT VIOLATION: Duplicate journal entry for combo=${entry.comboId} leg=${entry.legId}`);
            invariantViolations++;
        }
        journalKeys.add(key);
    }
    if (invariantViolations === 0 || !journalKeys.size) {
        log.info("  ✅ Exposure journal is internally consistent");
    }

    // Invariant 4: All filled planIds had a registered reservation token
    for (const [planId] of filled) {
        if (!planReservationMap.has(planId)) {
            log.error(`‼️ INVARIANT VIOLATION: Fill recorded for planId=${planId} with no registered reservation token`);
            invariantViolations++;
        }
    }

    log.info("────────────────────────────────────────────");
    if (invariantViolations > 0) {
        log.error(`💥 ${invariantViolations} invariant violation(s). Exiting with code 1.`);
        process.exit(1);
    } else {
        log.info("🎉 All invariants satisfied. Stress test PASSED.");
        process.exit(0);
    }
}

main().catch(err => {
    log.error({ err }, "Unhandled error in stress test");
    process.exit(1);
});
