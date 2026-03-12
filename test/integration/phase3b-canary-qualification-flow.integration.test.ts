import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
    QualificationAdminService,
    QualificationPromotionGateBlockedError,
    createDefaultPromotionGateConfig
} from "../../src/api/admin/qualification-admin-service.js";
import { ControlPlaneAdminService } from "../../src/api/admin/control-plane-admin-service.js";
import {
    AutoSafetyActionEngine,
    createDefaultAutoSafetyActionConfig
} from "../../src/core/qualification/auto-safety-action-engine.js";
import { PromotionGateEvaluator } from "../../src/core/qualification/promotion-gate-evaluator.js";
import {
    QualificationMetricsRollup,
    type QualificationMetricsRollupConfig
} from "../../src/core/qualification/qualification-metrics-rollup.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { promotionGateFailTotal } from "../../src/observability/metrics.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const rollupConfig: QualificationMetricsRollupConfig = {
    promotionReadiness: {
        version: "rollup-v1",
        internalizationRate: { weight: 0.2, max: "0.5" },
        compressionRatio: { weight: 0.2, max: "0.5" },
        feeSavings: { weight: 0.2, max: "10" },
        slippageSavings: { weight: 0.15, max: "10" },
        fillQualityDelta: { weight: 0.15, max: "1" },
        adverseSelectionIndicator: { weight: 0.1, max: "1" }
    }
};

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

const metricTotalForStage = async (stage: string): Promise<number> => {
    const snapshot = await promotionGateFailTotal.get();
    return snapshot.values
        .filter((entry) => entry.labels.stage === stage)
        .reduce((sum, entry) => sum + entry.value, 0);
};

describe.skipIf(!ENV_READY)("Phase 3B canary qualification flow", () => {
    let pool: Pool | undefined;
    const runIds = new Set<string>();
    const strategyKeys = new Set<string>();
    const shardIds = new Set<string>();

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
        if (strategyKeys.size > 0) {
            await must(pool, "pool").query(`DELETE FROM auto_safety_actions WHERE strategy_key = ANY($1::text[])`, [[...strategyKeys]]);
            await must(pool, "pool").query(`DELETE FROM strategy_promotion_events WHERE strategy_key = ANY($1::text[])`, [[...strategyKeys]]);
        }
        if (runIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM strategy_qualification_runs WHERE id = ANY($1::uuid[])`, [[...runIds]]);
        }
        if (shardIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM planner_shard_state WHERE shard_id = ANY($1::text[])`, [[...shardIds]]);
            await must(pool, "pool").query(`DELETE FROM control_plane_audit_events WHERE created_by = 'auto-safety-action-engine'`);
            await must(pool, "pool").query(`DELETE FROM control_plane_overrides WHERE created_by = 'auto-safety-action-engine'`);
        }
        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("promotes from SHADOW to CANARY with sufficient evidence, blocks a bad run, and supports pause/demote recovery", async () => {
        const strategyKey = `phase3b.canary.${Date.now()}`;
        strategyKeys.add(strategyKey);

        const service = new QualificationAdminService({
            pool: must(pool, "pool"),
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig()),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const rollup = new QualificationMetricsRollup(must(pool, "pool"), rollupConfig);

        const goodRunInsert = await must(pool, "pool").query<{ id: string }>(
            `INSERT INTO strategy_qualification_runs (strategy_key, scope_type, scope_id, stage, engine_version, config_version, status, metadata)
             VALUES ($1, 'MARKET', 'market-canary', 'SHADOW', 'eng-v1', 'cfg-v1', 'RUNNING', $2::jsonb)
             RETURNING id`,
            [
                strategyKey,
                JSON.stringify({
                    promotionGateSignals: {
                        replayStability: { matchRate: 0.999, diffRate: 0.001, errorRate: 0, consecutiveStableRuns: 20 },
                        reconciliationHealth: { mismatchCount: 0, mismatchRate: 0, infraErrorCount: 0, lockConflictCount: 0 },
                        plannerLatency: { p95Ms: 100, p99Ms: 180 },
                        incidentCount: { incidents: 0, unresolvedIncidents: 0 },
                        adverseSelection: { adverseFillRate: 0.01, postTradeMarkoutLoss: "0.01", lossRate: 0.005 }
                    }
                })
            ]
        );
        const goodRunId = goodRunInsert.rows[0]!.id;
        runIds.add(goodRunId);

        await must(pool, "pool").query(
            `INSERT INTO strategy_decision_evaluations
                (qualification_run_id, decision_type, entity_id, realized_metrics, counterfactual_metrics, improvement_metrics)
             VALUES
                ($1, 'SOR_CONFIG_CHANGE', 'rfq-good-1', $2::jsonb, $3::jsonb, $4::jsonb),
                ($1, 'PHASE2B_CLEARING_STRATEGY_CHANGE', 'bucket-good-1', $5::jsonb, $6::jsonb, $7::jsonb)`,
            [
                goodRunId,
                JSON.stringify({
                    market: "market-canary",
                    venuePair: "venue-a->venue-b",
                    externalNotional: "70",
                    internalizedNotional: "20",
                    compressionNotional: "10",
                    adverseSelectionIndicator: "0.02"
                }),
                JSON.stringify({ market: "market-canary", venuePair: "venue-a->venue-b" }),
                JSON.stringify({
                    priceImprovement: "0.05",
                    slippageSaved: "0.05",
                    feeSaved: "0.02",
                    externalNotionalAvoided: "3",
                    internalizationGain: "3",
                    compressionGain: "1"
                }),
                JSON.stringify({
                    market: "market-canary",
                    venuePair: "venue-a->venue-b",
                    externalNotional: "30",
                    internalizedNotional: "10",
                    compressionNotional: "5",
                    adverseSelectionIndicator: "0.03"
                }),
                JSON.stringify({ market: "market-canary", venuePair: "venue-a->venue-b" }),
                JSON.stringify({
                    priceImprovement: "0.02",
                    slippageSaved: "0.02",
                    feeSaved: "0.01",
                    externalNotionalAvoided: "2",
                    internalizationGain: "2",
                    compressionGain: "1"
                })
            ]
        );

        await rollup.refresh();
        const rollupRow = await rollup.get({
            strategyKey,
            scopeType: "MARKET",
            scopeId: "market-canary",
            stage: "SHADOW",
            engineVersion: "eng-v1",
            configVersion: "cfg-v1",
            market: "market-canary",
            venuePair: "venue-a->venue-b"
        });
        expect(rollupRow).not.toBeNull();
        expect(rollupRow?.promotionReadinessScore).toBeGreaterThan(0);

        const beforeHappyPathGateFails = await metricTotalForStage("SHADOW");
        const promoted = await service.promoteRun(goodRunId, "ops-admin@example.com");
        const afterHappyPathGateFails = await metricTotalForStage("SHADOW");

        expect(promoted.run.stage).toBe(QualificationStage.CANARY);
        expect(promoted.promotionEvent.fromStage).toBe(QualificationStage.SHADOW);
        expect(promoted.promotionEvent.toStage).toBe(QualificationStage.CANARY);
        expect(afterHappyPathGateFails).toBe(beforeHappyPathGateFails);

        const shardId = `phase3b-canary-shard-${Date.now()}`;
        shardIds.add(shardId);
        await must(pool, "pool").query(
            `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
             VALUES ($1, 'FULL_MODE', 1, 1, 0, 100)`,
            [shardId]
        );

        const autoSafetyActionEngine = new AutoSafetyActionEngine({
            pool: must(pool, "pool"),
            controlPlaneAdminService: new ControlPlaneAdminService({
                pool: must(pool, "pool"),
                logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
            }),
            config: createDefaultAutoSafetyActionConfig(),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const safetyAction = await autoSafetyActionEngine.evaluate({
            strategyKey,
            scopeType: "shard",
            scopeId: shardId,
            shardId,
            currentStage: QualificationStage.CANARY,
            signals: {
                replayDiffSpike: { diffRate: 0.05, errorRate: 0.01, breachedWindows: 3, sustainedDurationMs: 5000 },
                reconciliationMismatchSpike: { mismatchCount: 0, mismatchRate: 0, infraErrorCount: 0, lockConflictCount: 0, breachedWindows: 0, sustainedDurationMs: 0 },
                plannerLatencyBreach: { p95Ms: 100, p99Ms: 150, breachedWindows: 0, sustainedDurationMs: 0 },
                negativeEconomicQuality: { priceImprovement: "1", slippageSaved: "1", feeSaved: "1", externalNotionalAvoided: "1", internalizationGain: "1", compressionGain: "1", breachedWindows: 0, sustainedDurationMs: 0 },
                staleReservationGrowth: { staleReservationCount: 0, growthRate: 0, breachedWindows: 0, sustainedDurationMs: 0 },
                internalizationFailureSpike: { failureCount: 0, failureRate: 0, breachedWindows: 0, sustainedDurationMs: 0 }
            }
        });
        expect(safetyAction.appliedAction?.id).toBeDefined();

        const runAfterSafety = await service.getRun(goodRunId);
        expect(runAfterSafety.stage).toBe(QualificationStage.CANARY);

        const paused = await service.pauseRun(goodRunId, "operator hold", "ops-admin@example.com");
        expect(paused.run.status).toBe(QualificationRunStatus.PAUSED);

        const demoted = await service.demoteRun(
            goodRunId,
            QualificationStage.SHADOW,
            "canary rollback",
            "ops-admin@example.com"
        );
        expect(demoted.run.stage).toBe(QualificationStage.SHADOW);

        const eventRows = await must(pool, "pool").query<{ from_stage: string; to_stage: string }>(
            `SELECT from_stage, to_stage
             FROM strategy_promotion_events
             WHERE strategy_key = $1
             ORDER BY created_at ASC`,
            [strategyKey]
        );
        expect(eventRows.rows).toEqual([
            { from_stage: "SHADOW", to_stage: "CANARY" },
            { from_stage: "CANARY", to_stage: "SHADOW" }
        ]);

        const badRunInsert = await must(pool, "pool").query<{ id: string }>(
            `INSERT INTO strategy_qualification_runs (strategy_key, scope_type, scope_id, stage, engine_version, config_version, status, metadata)
             VALUES ($1, 'MARKET', 'market-canary-bad', 'SHADOW', 'eng-v1', 'cfg-v1', 'RUNNING', $2::jsonb)
             RETURNING id`,
            [
                `${strategyKey}.blocked`,
                JSON.stringify({
                    promotionGateSignals: {
                        replayStability: { matchRate: 0.90, diffRate: 0.08, errorRate: 0.02, consecutiveStableRuns: 1 },
                        reconciliationHealth: { mismatchCount: 2, mismatchRate: 0.2, infraErrorCount: 1, lockConflictCount: 1 },
                        plannerLatency: { p95Ms: 500, p99Ms: 900 },
                        incidentCount: { incidents: 1, unresolvedIncidents: 1 },
                        adverseSelection: { adverseFillRate: 0.2, postTradeMarkoutLoss: "0.5", lossRate: 0.2 }
                    }
                })
            ]
        );
        const badRunId = badRunInsert.rows[0]!.id;
        runIds.add(badRunId);
        strategyKeys.add(`${strategyKey}.blocked`);

        await must(pool, "pool").query(
            `INSERT INTO strategy_decision_evaluations
                (qualification_run_id, decision_type, entity_id, realized_metrics, counterfactual_metrics, improvement_metrics)
             VALUES ($1, 'SOR_CONFIG_CHANGE', 'rfq-bad-1', $2::jsonb, $3::jsonb, $4::jsonb)`,
            [
                badRunId,
                JSON.stringify({ market: "market-canary-bad", venuePair: "venue-a->venue-b" }),
                JSON.stringify({ market: "market-canary-bad", venuePair: "venue-a->venue-b" }),
                JSON.stringify({
                    priceImprovement: "-0.01",
                    slippageSaved: "-0.01",
                    feeSaved: "-0.01",
                    externalNotionalAvoided: "-1",
                    internalizationGain: "-1",
                    compressionGain: "-0.5"
                })
            ]
        );

        const beforeBlockedGateFails = await metricTotalForStage("SHADOW");
        await expect(service.promoteRun(badRunId, "ops-admin@example.com")).rejects.toBeInstanceOf(
            QualificationPromotionGateBlockedError
        );
        const afterBlockedGateFails = await metricTotalForStage("SHADOW");
        expect(afterBlockedGateFails).toBeGreaterThan(beforeBlockedGateFails);

        const blockedRun = await service.getRun(badRunId);
        expect(blockedRun.stage).toBe(QualificationStage.SHADOW);
    }, 30000);
});
