import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ControlPlaneAdminService } from "../../src/api/admin/control-plane-admin-service.js";
import {
    AutoSafetyActionEngine,
    type AutoSafetyActionConfig
} from "../../src/core/qualification/auto-safety-action-engine.js";
import { AutoSafetyActionType, QualificationStage } from "../../src/core/qualification/qualification.types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const applyMigrations = async (pool: Pool): Promise<void> => {
    const migrationDirs = [
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

const config: AutoSafetyActionConfig = {
    version: "phase3b-auto-safety-v1",
    thresholds: {
        replayDiffSpike: { maxDiffRate: 0.02, maxErrorRate: 0.005, minBreachedWindows: 2, minDurationMs: 1000 },
        reconciliationMismatchSpike: {
            maxMismatchCount: 0,
            maxMismatchRate: 0,
            maxInfraErrorCount: 0,
            maxLockConflictCount: 0,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        plannerLatencyBreach: { maxP95Ms: 250, maxP99Ms: 400, minBreachedWindows: 2, minDurationMs: 1000 },
        negativeEconomicQuality: {
            minPriceImprovement: "0",
            minSlippageSaved: "0",
            minFeeSaved: "0",
            minExternalNotionalAvoided: "0",
            minInternalizationGain: "0",
            minCompressionGain: "0",
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        staleReservationGrowth: {
            maxStaleReservationCount: 10,
            maxGrowthRate: 0.25,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        internalizationFailureSpike: {
            maxFailureCount: 2,
            maxFailureRate: 0.1,
            minBreachedWindows: 2,
            minDurationMs: 1000
        }
    },
    actions: {
        replay_diff_spike: AutoSafetyActionType.DISABLE_PHASE2B,
        reconciliation_mismatch_spike: AutoSafetyActionType.DISABLE_PHASE2A_AND_2B,
        planner_latency_breach_sustained: AutoSafetyActionType.FORCE_SOR_ONLY,
        negative_economic_quality_sustained: AutoSafetyActionType.DEMOTE_STAGE,
        stale_reservation_growth: AutoSafetyActionType.PAUSE_SCOPE,
        internalization_failure_spike: AutoSafetyActionType.DISABLE_RESOLUTION_POOLING
    },
    cooldownMs: 0,
    resolutionPoolingOverrideTtlMs: 300000,
    sorOnlyOverrideTtlMs: 120000
};

describe.skipIf(!ENV_READY)("AutoSafetyActionEngine integration", () => {
    let pool: Pool | undefined;
    const shardIds = new Set<string>();
    const bucketIds = new Set<string>();
    const strategyKeys = new Set<string>();

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
            await must(pool, "pool").query(`DELETE FROM control_plane_overrides WHERE created_by = 'auto-safety-action-engine'`);
        }
        if (bucketIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM bucket_state WHERE bucket_id = ANY($1::text[])`, [[...bucketIds]]);
        }
        if (shardIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM planner_shard_state WHERE shard_id = ANY($1::text[])`, [[...shardIds]]);
            await must(pool, "pool").query(`DELETE FROM control_plane_audit_events WHERE created_by = 'auto-safety-action-engine'`);
        }

        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("persists a DISABLE_PHASE2B action and mutates shard control-plane state", async () => {
        const strategyKey = `phase3b.auto-safety.${Date.now()}`;
        const shardId = `shard-${Date.now()}`;
        strategyKeys.add(strategyKey);
        shardIds.add(shardId);

        await must(pool, "pool").query(
            `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
             VALUES ($1, 'FULL_MODE', 1, 1, 0, 100)`,
            [shardId]
        );

        const adminService = new ControlPlaneAdminService({
            pool: must(pool, "pool"),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const engine = new AutoSafetyActionEngine({
            pool: must(pool, "pool"),
            controlPlaneAdminService: adminService,
            config,
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const result = await engine.evaluate({
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

        expect(result.actionType).toBe(AutoSafetyActionType.DISABLE_PHASE2B);

        const actionRows = await must(pool, "pool").query<{ action_type: string; resolved_at: Date | null }>(
            `SELECT action_type, resolved_at
             FROM auto_safety_actions
             WHERE strategy_key = $1`,
            [strategyKey]
        );
        expect(actionRows.rowCount).toBe(1);
        expect(actionRows.rows[0]).toMatchObject({
            action_type: "DISABLE_PHASE2B",
            resolved_at: null
        });

        const shardRows = await must(pool, "pool").query<{ mode: string }>(
            `SELECT mode FROM planner_shard_state WHERE shard_id = $1`,
            [shardId]
        );
        expect(shardRows.rows[0]?.mode).toBe("DISABLE_PHASE2B");
    });

    it("creates a resolution-pooling override and resolves the recorded action", async () => {
        const now = Date.now() + 1;
        const strategyKey = `phase3b.auto-safety.override.${now}`;
        const shardId = `shard-${now}`;
        const bucketId = `bucket-${now}`;
        strategyKeys.add(strategyKey);
        shardIds.add(shardId);
        bucketIds.add(bucketId);

        await must(pool, "pool").query(
            `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
             VALUES ($1, 'FULL_MODE', 1, 1, 0, 100)`,
            [shardId]
        );
        await must(pool, "pool").query(
            `INSERT INTO bucket_state (bucket_id, bucket_type, mode, entity_count, graph_density, degradation_reason)
             VALUES ($1, 'CLEARING', 'ACTIVE', 10, 0.3, NULL)`,
            [bucketId]
        );

        const adminService = new ControlPlaneAdminService({
            pool: must(pool, "pool"),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const engine = new AutoSafetyActionEngine({
            pool: must(pool, "pool"),
            controlPlaneAdminService: adminService,
            config,
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const result = await engine.evaluate({
            strategyKey,
            scopeType: "bucket",
            scopeId: bucketId,
            shardId,
            bucketId,
            currentStage: QualificationStage.SHADOW,
            signals: {
                replayDiffSpike: { diffRate: 0, errorRate: 0, breachedWindows: 0, sustainedDurationMs: 0 },
                reconciliationMismatchSpike: { mismatchCount: 0, mismatchRate: 0, infraErrorCount: 0, lockConflictCount: 0, breachedWindows: 0, sustainedDurationMs: 0 },
                plannerLatencyBreach: { p95Ms: 100, p99Ms: 150, breachedWindows: 0, sustainedDurationMs: 0 },
                negativeEconomicQuality: { priceImprovement: "1", slippageSaved: "1", feeSaved: "1", externalNotionalAvoided: "1", internalizationGain: "1", compressionGain: "1", breachedWindows: 0, sustainedDurationMs: 0 },
                staleReservationGrowth: { staleReservationCount: 0, growthRate: 0, breachedWindows: 0, sustainedDurationMs: 0 },
                internalizationFailureSpike: { failureCount: 5, failureRate: 0.3, breachedWindows: 3, sustainedDurationMs: 5000 }
            }
        });

        expect(result.actionType).toBe(AutoSafetyActionType.DISABLE_RESOLUTION_POOLING);

        const overrideRows = await must(pool, "pool").query<{ override_type: string; payload: { policy?: string } }>(
            `SELECT override_type, payload
             FROM control_plane_overrides
             WHERE scope_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [bucketId]
        );
        expect(overrideRows.rowCount).toBe(1);
        expect(overrideRows.rows[0]?.override_type).toBe("GUARDRAIL_ENFORCEMENT");
        expect(overrideRows.rows[0]?.payload.policy).toBe("DISABLE_RESOLUTION_POOLING");

        const resolved = await engine.resolveAction(result.appliedAction!.id, { resolvedBy: "integration-test" });
        expect(resolved.resolvedAt).not.toBeNull();

        const actionRow = await must(pool, "pool").query<{ resolved_at: Date | null }>(
            `SELECT resolved_at
             FROM auto_safety_actions
             WHERE id = $1`,
            [result.appliedAction!.id]
        );
        expect(actionRow.rows[0]?.resolved_at).not.toBeNull();
    });
});
