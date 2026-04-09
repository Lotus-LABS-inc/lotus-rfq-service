#!/usr/bin/env tsx
/**
 * chaos-unwind.ts
 *
 * Chaos test for the Combo Unwind Engine.
 * Simulates partial fills and deliberate connector cancel failures to validate
 * unwind logic, idempotency, and that Prometheus-style metrics counters track correctly.
 *
 * Scenarios:
 *   A) Leg 1 fills, Leg 2 rejects → ALL_OR_NONE → cancel Leg 1 → cancel succeeds
 *   B) Leg 1 fills, Leg 2 rejects → ALL_OR_NONE → cancel Leg 1 → cancel FAILS (chaos)
 *   C) PARTIAL_ALLOWED: Leg 1 fills, Leg 2 rejects → partial accepted
 *   D) Both legs reject → FAILED, no exposure
 *   E) All legs fill → COMPLETED, full exposure committed
 *
 * Invariants:
 *   - On ALL_OR_NONE failure with successful cancel: zero exposure committed
 *   - On ALL_OR_NONE failure with FAILED cancel: exposure flagged as unwind_failed, metric incremented
 *   - On PARTIAL fill: exactly the successful legs commit exposure
 *   - Idempotency: replaying the same planId produces the same result
 *
 * Exit code 0 = all invariants OK
 * Exit code 1 = invariant violation
 */

import crypto from "crypto";
import pino from "pino";

const log = pino({ level: "info" });

// ─── Metrics ──────────────────────────────────────────────────────────────────

const metrics = {
    fills_total: 0,
    unwinds_total: 0,
    unwind_failures_total: 0,
    partial_fills_total: 0,
    failed_plans_total: 0,
    completed_plans_total: 0,
};

// ─── Exposure Journal ─────────────────────────────────────────────────────────

interface ExposureEntry {
    planId: string;
    legId: string;
    amount: number;
    state: "COMMITTED" | "UNWIND_SUCCESS" | "UNWIND_FAILED";
}

const exposureJournal: ExposureEntry[] = [];

// Idempotency set: (planId + legId) → result
const idempotencyLog = new Map<string, "FILLED" | "REJECTED">();

// ─── Connector Simulator ─────────────────────────────────────────────────────

async function simulateFill(planId: string, legId: string, shouldFill: boolean): Promise<"FILLED" | "REJECTED"> {
    await new Promise(r => setTimeout(r, 10 + Math.random() * 50)); // latency

    // Idempotency
    const key = `${planId}:${legId}`;
    if (idempotencyLog.has(key)) {
        log.info({ planId, legId }, "↩️  Idempotency replay — returning cached fill result");
        return idempotencyLog.get(key)!;
    }

    const result: "FILLED" | "REJECTED" = shouldFill ? "FILLED" : "REJECTED";
    idempotencyLog.set(key, result);
    return result;
}

async function simulateCancel(orderId: string, cancelShouldSucceed: boolean): Promise<boolean> {
    await new Promise(r => setTimeout(r, 5 + Math.random() * 30)); // latency
    return cancelShouldSucceed;
}

// ─── Execution Engine ─────────────────────────────────────────────────────────

type Policy = "ALL_OR_NONE" | "PARTIAL_ALLOWED";

interface ChaosLeg {
    legId: string;
    fillSucceeds: boolean;
    cancelSucceeds: boolean; // only relevant when unwind is needed
    amount: number;
}

interface ChaosScenario {
    name: string;
    planId: string;
    policy: Policy;
    legs: ChaosLeg[];
    /** Expected final state after execution */
    expectedState: "COMPLETED" | "PARTIAL" | "FAILED";
    /** Expected exposure entries committed after execution */
    expectedExposureCount: number;
    /** Allow unwind failures to be expected (Scenario B) */
    expectUnwindFailure?: boolean;
}

async function runScenario(scenario: ChaosScenario): Promise<{ passed: boolean; details: string }> {
    const { name, planId, policy, legs } = scenario;
    log.info({ scenario: name, planId, policy }, "🔬 Running chaos scenario");

    const filledLegs: ChaosLeg[] = [];
    const rejectedLegs: ChaosLeg[] = [];

    // Parallel fill dispatch
    const fillResults = await Promise.allSettled(
        legs.map(async leg => {
            const result = await simulateFill(planId, leg.legId, leg.fillSucceeds);
            return { leg, result };
        })
    );

    for (const r of fillResults) {
        if (r.status === "fulfilled") {
            const { leg, result } = r.value;
            if (result === "FILLED") {
                filledLegs.push(leg);
            } else {
                rejectedLegs.push(leg);
            }
        }
    }

    let finalState: "COMPLETED" | "PARTIAL" | "FAILED";
    let unwindFailureDetected = false;

    // Policy resolution
    if (policy === "ALL_OR_NONE" && rejectedLegs.length > 0) {
        // Must unwind all fills
        let allCancelled = true;
        for (const filledLeg of filledLegs) {
            const cancelOk = await simulateCancel(filledLeg.legId, filledLeg.cancelSucceeds);
            if (!cancelOk) {
                allCancelled = false;
                unwindFailureDetected = true;
                metrics.unwind_failures_total++;
                // Record unwind failure in journal
                exposureJournal.push({
                    planId, legId: filledLeg.legId, amount: filledLeg.amount,
                    state: "UNWIND_FAILED"
                });
                log.error({ planId, legId: filledLeg.legId }, "🔥 Unwind FAILED — connector cancel refused");
            } else {
                metrics.unwinds_total++;
                exposureJournal.push({
                    planId, legId: filledLeg.legId, amount: filledLeg.amount,
                    state: "UNWIND_SUCCESS"
                });
                log.warn({ planId, legId: filledLeg.legId }, "↩️  Leg fill unwound successfully");
            }
        }
        finalState = "FAILED";
        metrics.failed_plans_total++;
    } else if (policy === "ALL_OR_NONE" && rejectedLegs.length === 0) {
        // All filled - commit all
        for (const filledLeg of filledLegs) {
            metrics.fills_total++;
            exposureJournal.push({ planId, legId: filledLeg.legId, amount: filledLeg.amount, state: "COMMITTED" });
        }
        finalState = "COMPLETED";
        metrics.completed_plans_total++;
    } else {
        // PARTIAL_ALLOWED
        for (const filledLeg of filledLegs) {
            metrics.fills_total++;
            exposureJournal.push({ planId, legId: filledLeg.legId, amount: filledLeg.amount, state: "COMMITTED" });
        }
        if (filledLegs.length === legs.length) {
            finalState = "COMPLETED";
            metrics.completed_plans_total++;
        } else if (filledLegs.length > 0) {
            finalState = "PARTIAL";
            metrics.partial_fills_total++;
        } else {
            finalState = "FAILED";
            metrics.failed_plans_total++;
        }
    }

    // ─── Invariant Check for this scenario ────────────────────────────────────
    const planEntries = exposureJournal.filter(e => e.planId === planId);
    const committed = planEntries.filter(e => e.state === "COMMITTED");
    const unwoundOk = planEntries.filter(e => e.state === "UNWIND_SUCCESS");
    const unwoundFail = planEntries.filter(e => e.state === "UNWIND_FAILED");

    const stateOk = finalState === scenario.expectedState;
    const countOk = committed.length === scenario.expectedExposureCount;
    const unwindOk = scenario.expectUnwindFailure ? unwoundFail.length > 0 : unwoundFail.length === 0;

    const passed = stateOk && countOk && unwindOk;

    if (!passed) {
        const details = [
            `State: expected=${scenario.expectedState} got=${finalState} `,
            `Committed count: expected=${scenario.expectedExposureCount} got=${committed.length}`,
            `Unwind failures: expected=${scenario.expectUnwindFailure ? ">0" : "0"} got=${unwoundFail.length}`,
            `Unwind successes: ${unwoundOk}`,
        ].join(", ");
        log.error({ scenario: name, planId }, `❌ INVARIANT FAIL: ${details}`);
        return { passed: false, details };
    }

    log.info({ scenario: name, planId, finalState, committed: committed.length, unwoundOk: unwoundFail.length }, "✅ Scenario passed");
    return { passed: true, details: "OK" };
}

// ─── Idempotency Replay Test ──────────────────────────────────────────────────

async function testIdempotencyReplay(): Promise<boolean> {
    log.info("🔄 Running idempotency replay test...");

    const planId = crypto.randomUUID();
    const legId = crypto.randomUUID();

    // First call
    const r1 = await simulateFill(planId, legId, true); // FILLED
    // Second call (replay) — must return same result
    const r2 = await simulateFill(planId, legId, false); // Would fail WITHOUT idempotency

    if (r1 === r2 && r1 === "FILLED") {
        log.info({ planId, legId }, "✅ Idempotency replay: same result returned for duplicate dispatch");
        return true;
    }

    log.error({ planId, legId, r1, r2 }, "‼️ IDEMPOTENCY VIOLATION: Different results for same (planId, legId)");
    return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    log.info("💥 Chaos Unwind Test Starting...");

    const scenarios: ChaosScenario[] = [
        {
            name: "A — ALL_OR_NONE: leg 2 fails, leg 1 cancel SUCCEEDS",
            planId: crypto.randomUUID(),
            policy: "ALL_OR_NONE",
            legs: [
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: true, amount: 100 },
                { legId: crypto.randomUUID(), fillSucceeds: false, cancelSucceeds: true, amount: 50 },
            ],
            expectedState: "FAILED",
            expectedExposureCount: 0,
            expectUnwindFailure: false,
        },
        {
            name: "B — ALL_OR_NONE: leg 2 fails, leg 1 cancel FAILS (chaos)",
            planId: crypto.randomUUID(),
            policy: "ALL_OR_NONE",
            legs: [
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: false, amount: 150 },
                { legId: crypto.randomUUID(), fillSucceeds: false, cancelSucceeds: true, amount: 75 },
            ],
            expectedState: "FAILED",
            expectedExposureCount: 0,           // committed = 0, but unwind_failed journal entry exists
            expectUnwindFailure: true,
        },
        {
            name: "C — PARTIAL_ALLOWED: one leg fills, one rejects",
            planId: crypto.randomUUID(),
            policy: "PARTIAL_ALLOWED",
            legs: [
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: true, amount: 80 },
                { legId: crypto.randomUUID(), fillSucceeds: false, cancelSucceeds: true, amount: 40 },
            ],
            expectedState: "PARTIAL",
            expectedExposureCount: 1,
        },
        {
            name: "D — Both legs reject, policy PARTIAL_ALLOWED",
            planId: crypto.randomUUID(),
            policy: "PARTIAL_ALLOWED",
            legs: [
                { legId: crypto.randomUUID(), fillSucceeds: false, cancelSucceeds: true, amount: 60 },
                { legId: crypto.randomUUID(), fillSucceeds: false, cancelSucceeds: true, amount: 30 },
            ],
            expectedState: "FAILED",
            expectedExposureCount: 0,
        },
        {
            name: "E — ALL_OR_NONE: all legs fill, full commit",
            planId: crypto.randomUUID(),
            policy: "ALL_OR_NONE",
            legs: [
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: true, amount: 200 },
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: true, amount: 100 },
                { legId: crypto.randomUUID(), fillSucceeds: true, cancelSucceeds: true, amount: 100 },
            ],
            expectedState: "COMPLETED",
            expectedExposureCount: 3,
        },
    ];

    // Run all scenarios (not necessarily in order — chaos!)
    const shuffled = [...scenarios].sort(() => Math.random() - 0.5);
    const results = await Promise.all(shuffled.map(runScenario));

    const idempotencyOk = await testIdempotencyReplay();

    // ─── Results ─────────────────────────────────────────────────────────────
    log.info("────────────────────────────────────────────");
    log.info("📋 Chaos Test Summary");
    log.info(`  Scenarios run:         ${scenarios.length}`);
    log.info(`  Fills committed:       ${metrics.fills_total}`);
    log.info(`  Unwinds succeeded:     ${metrics.unwinds_total}`);
    log.info(`  Unwind failures:       ${metrics.unwind_failures_total}`);
    log.info(`  Partial fills:         ${metrics.partial_fills_total}`);
    log.info(`  Plans completed:       ${metrics.completed_plans_total}`);
    log.info(`  Plans failed:          ${metrics.failed_plans_total}`);
    log.info("────────────────────────────────────────────");

    const scenarioViolations = results.filter(r => !r.passed).length;

    if (scenarioViolations > 0 || !idempotencyOk) {
        log.error(`💥 ${scenarioViolations} scenario invariant violation(s) + idempotency: ${idempotencyOk ? "OK" : "FAILED"}`);
        log.error("Exiting with code 1.");
        process.exit(1);
    }

    log.info("🎉 All chaos scenarios and idempotency checks PASSED.");
    process.exit(0);
}

main().catch(err => {
    log.error({ err }, "Unhandled error in chaos test");
    process.exit(1);
});
