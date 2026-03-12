import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { EconomicQualityEngine } from "../../src/core/qualification/economic-quality-engine.js";
import { QualificationRunManager } from "../../src/core/qualification/qualification-run-manager.js";
import { QualificationRuntimeHook } from "../../src/core/qualification/runtime-qualification-hook.js";
import { ShadowQualificationEvaluator } from "../../src/core/qualification/shadow-qualification-evaluator.js";
import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { shadowDecisionDiffTotal } from "../../src/observability/metrics.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const applyMigrations = async (pool: Pool): Promise<void> => {
    const migrationDirs = [
        path.resolve(process.cwd(), "infra", "migrations"),
        path.resolve(process.cwd(), "sql", "migrations")
    ];

    for (const migrationsDir of migrationDirs) {
        const files = (await readdir(migrationsDir))
            .filter((name) => name.endsWith(".sql"))
            .sort((left, right) => left.localeCompare(right));

        for (const file of files) {
            const sql = await readFile(path.join(migrationsDir, file), "utf8");
            try {
                await pool.query(sql);
            } catch (error) {
                const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
                if (code === "42P07" || code === "42710") {
                    continue;
                }
                throw error;
            }
        }
    }
};

const metricTotalFor = async (decisionType: string): Promise<number> => {
    const snapshot = await shadowDecisionDiffTotal.get();
    return snapshot.values
        .filter((entry) => entry.labels.decision_type === decisionType)
        .reduce((sum, entry) => sum + entry.value, 0);
};

describe.skipIf(!ENV_READY)("Phase 3B shadow validation", () => {
    let pool: Pool | undefined;
    const runIds = new Set<string>();

    const must = <T>(value: T | undefined, name: string): T => {
        if (value === undefined) {
            throw new Error(`${name} not initialized`);
        }
        return value;
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL as string });
        await applyMigrations(must(pool, "pool"));
    }, 180000);

    afterAll(async () => {
        if (runIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM strategy_qualification_runs WHERE id = ANY($1::uuid[])`, [[...runIds]]);
        }
        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("writes deterministic shadow qualification evidence across all six decision families without mutating live outputs", async () => {
        const runManager = new QualificationRunManager({
            pool: must(pool, "pool"),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: runManager,
            economicQualityEngine: new EconomicQualityEngine(),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const hook = new QualificationRuntimeHook({
            qualificationRunManager: runManager,
            shadowQualificationEvaluator: evaluator,
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const sorRun = await runManager.createRun("strategy.sor.validation", "MARKET", "market-sor-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        const groupingRun = await runManager.createRun("strategy.grouping.validation", "EVENT", "event-grouping-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        const riskRun = await runManager.createRun("strategy.risk.validation", "EVENT", "event-risk-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        const crossRun = await runManager.createRun("strategy.cross.validation", "MARKET", "market-cross-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        const nettingRun = await runManager.createRun("strategy.netting.validation", "MARKET", "market-netting-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        const clearingRun = await runManager.createRun("strategy.clearing.validation", "BUCKET", "bucket-clearing-validation", QualificationStage.SHADOW, "eng-v1", "cfg-shadow");
        [sorRun, groupingRun, riskRun, crossRun, nettingRun, clearingRun].forEach((run) => runIds.add(run.id));

        const liveSor = Object.freeze({
            routeIds: ["route-live"],
            providerIds: ["venue-live"],
            allocations: [{ candidateId: "cand-live", providerId: "venue-live", targetSize: "10", targetPrice: "1.01" }]
        });
        await hook.emitEvaluation({
            strategyKey: sorRun.strategyKey,
            scopeType: sorRun.scopeType,
            scopeId: sorRun.scopeId,
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-sor-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveSor,
            shadowDecision: () => ({
                routeIds: ["route-shadow"],
                providerIds: ["venue-shadow"],
                allocations: [{ candidateId: "cand-shadow", providerId: "venue-shadow", targetSize: "10", targetPrice: "1.00" }]
            }),
            metadata: {
                market: "market-sor-validation",
                venuePair: "venue-live->venue-shadow",
                liveVenue: "venue-live",
                shadowVenue: "venue-shadow"
            }
        });

        const liveGrouping = Object.freeze({
            safePools: [["venue-a", "venue-b"]],
            cautionLanes: [],
            blockedProfiles: ["venue-c"]
        });
        await hook.emitEvaluation({
            strategyKey: groupingRun.strategyKey,
            scopeType: groupingRun.scopeType,
            scopeId: groupingRun.scopeId,
            decisionType: "RFQ_GROUPING_CHANGE",
            entityId: "rfq-grouping-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveGrouping,
            shadowDecision: () => ({
                safePools: [["venue-a"]],
                cautionLanes: [["venue-b"]],
                blockedProfiles: ["venue-c"]
            }),
            metadata: {
                market: "event-grouping-validation",
                venuePair: "venue-a->venue-b"
            }
        });

        const liveRisk = Object.freeze({
            intendedDecision: "blocked",
            enforcedDecision: "blocked",
            equivalenceClass: "DO_NOT_POOL",
            reason: "high_divergence"
        });
        await hook.emitEvaluation({
            strategyKey: riskRun.strategyKey,
            scopeType: riskRun.scopeType,
            scopeId: riskRun.scopeId,
            decisionType: "RESOLUTION_RISK_THRESHOLD_CHANGE",
            entityId: "risk-threshold-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveRisk,
            shadowDecision: () => ({
                intendedDecision: "normal",
                enforcedDecision: "normal",
                equivalenceClass: "SAFE_EQUIVALENT",
                reason: "threshold_relaxed"
            }),
            metadata: {
                market: "event-risk-validation",
                venuePair: "risk-live->risk-shadow"
            }
        });

        const liveCross = Object.freeze({
            filledSize: "8",
            matchedOrderIds: ["maker-a", "maker-b"],
            remainingSize: "2"
        });
        await hook.emitEvaluation({
            strategyKey: crossRun.strategyKey,
            scopeType: crossRun.scopeType,
            scopeId: crossRun.scopeId,
            decisionType: "PHASE1_INTERNAL_CROSS_CHANGE",
            entityId: "cross-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveCross,
            shadowDecision: () => ({
                filledSize: "6",
                matchedOrderIds: ["maker-a"],
                remainingSize: "4"
            }),
            metadata: {
                market: "market-cross-validation",
                venuePair: "internal-cross->external"
            }
        });

        const liveNetting = Object.freeze({
            nettingGroupIds: ["group-a"],
            nettedSize: "5",
            residualLegs: [{ id: "leg-1", remainingSize: "2" }]
        });
        await hook.emitEvaluation({
            strategyKey: nettingRun.strategyKey,
            scopeType: nettingRun.scopeType,
            scopeId: nettingRun.scopeId,
            decisionType: "PHASE2A_NETTING_SCOPE_CHANGE",
            entityId: "netting-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveNetting,
            shadowDecision: () => ({
                nettingGroupIds: ["group-b"],
                nettedSize: "3",
                residualLegs: [{ id: "leg-1", remainingSize: "4" }]
            }),
            metadata: {
                market: "market-netting-validation",
                venuePair: "phase2a-live->phase2a-shadow"
            }
        });

        const liveClearing = Object.freeze({
            clearingRoundId: "round-live",
            participantSetHash: "psh-live",
            matchSignatureHash: "sig-live",
            compressionScore: "4",
            residuals: [{ key: "market:yes", signedResidual: "0" }]
        });
        const beforeClearingDiffs = await metricTotalFor("PHASE2B_CLEARING_STRATEGY_CHANGE");
        await hook.emitEvaluation({
            strategyKey: clearingRun.strategyKey,
            scopeType: clearingRun.scopeType,
            scopeId: clearingRun.scopeId,
            decisionType: "PHASE2B_CLEARING_STRATEGY_CHANGE",
            entityId: "bucket-clearing-validation",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => liveClearing,
            shadowDecision: () => ({
                clearingRoundId: "round-shadow",
                participantSetHash: "psh-shadow",
                matchSignatureHash: "sig-shadow",
                compressionScore: "5",
                residuals: [{ key: "market:yes", signedResidual: "1" }]
            }),
            metadata: {
                market: "bucket-clearing-validation",
                venuePair: "phase2b-live->phase2b-shadow"
            }
        });
        const afterClearingDiffs = await metricTotalFor("PHASE2B_CLEARING_STRATEGY_CHANGE");

        expect(liveSor.routeIds[0]).toBe("route-live");
        expect(liveGrouping.safePools[0]?.[0]).toBe("venue-a");
        expect(liveRisk.enforcedDecision).toBe("blocked");
        expect(liveCross.filledSize).toBe("8");
        expect(liveNetting.nettedSize).toBe("5");
        expect(liveClearing.clearingRoundId).toBe("round-live");
        expect(afterClearingDiffs).toBe(beforeClearingDiffs + 1);

        const evaluationCount = await must(pool, "pool").query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM strategy_decision_evaluations
             WHERE qualification_run_id = ANY($1::uuid[])`,
            [[...runIds]]
        );
        expect(Number(evaluationCount.rows[0]?.count ?? "0")).toBe(6);
    }, 30000);

    it("skips cleanly when no active run matches and fails closed under strict mode when multiple runs match", async () => {
        const runManager = new QualificationRunManager({
            pool: must(pool, "pool"),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: runManager,
            economicQualityEngine: new EconomicQualityEngine(),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const hook = new QualificationRuntimeHook({
            qualificationRunManager: runManager,
            shadowQualificationEvaluator: evaluator,
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const skipResult = await hook.emitEvaluation({
            strategyKey: "strategy.none.validation",
            scopeType: "MARKET",
            scopeId: "market-none",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-none",
            mode: "live_only",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => ({
                routeIds: ["route-live"],
                providerIds: ["venue-live"],
                allocations: []
            })
        });
        expect(skipResult).toBeNull();

        const duplicateRunA = await runManager.createRun("strategy.duplicate.validation", "MARKET", "market-duplicate", QualificationStage.SHADOW, "eng-v1", "cfg-dup");
        const duplicateRunB = await runManager.createRun("strategy.duplicate.validation", "MARKET", "market-duplicate", QualificationStage.SHADOW, "eng-v2", "cfg-dup");
        runIds.add(duplicateRunA.id);
        runIds.add(duplicateRunB.id);

        await expect(
            hook.emitEvaluation({
                strategyKey: "strategy.duplicate.validation",
                scopeType: "MARKET",
                scopeId: "market-duplicate",
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-duplicate",
                mode: "shadow_compare",
                failMode: "STRICT",
                liveDecision: () => ({
                    routeIds: ["route-live"],
                    providerIds: ["venue-live"],
                    allocations: []
                }),
                shadowDecision: () => ({
                    routeIds: ["route-shadow"],
                    providerIds: ["venue-shadow"],
                    allocations: []
                })
            })
        ).rejects.toThrow(/Multiple active qualification runs matched/);
    }, 30000);
});
