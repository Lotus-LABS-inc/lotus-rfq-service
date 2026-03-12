import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ControlPlaneAdminService } from "../../src/api/admin/control-plane-admin-service.js";
import { QualificationSafetyAdminService } from "../../src/api/admin/qualification-safety-admin-service.js";
import {
    AutoSafetyActionEngine,
    createDefaultAutoSafetyActionConfig
} from "../../src/core/qualification/auto-safety-action-engine.js";
import { QualificationStage } from "../../src/core/qualification/qualification.types.js";

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

describe.skipIf(!ENV_READY)("QualificationSafetyAdminService integration", () => {
    let pool: Pool | undefined;
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
        }
        if (shardIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM planner_shard_state WHERE shard_id = ANY($1::text[])`, [[...shardIds]]);
            await must(pool, "pool").query(`DELETE FROM control_plane_audit_events WHERE created_by = 'auto-safety-action-engine'`);
        }
        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("lists unresolved actions and resolves one without auto-rolling back control-plane state", async () => {
        const strategyKey = `phase3b.safety-admin.${Date.now()}`;
        const shardId = `phase3b-safety-admin-shard-${Date.now()}`;
        strategyKeys.add(strategyKey);
        shardIds.add(shardId);

        await must(pool, "pool").query(
            `INSERT INTO planner_shard_state (shard_id, mode, active_plans, active_buckets, stale_reservations, avg_planner_latency_ms)
             VALUES ($1, 'FULL_MODE', 1, 1, 0, 100)`,
            [shardId]
        );

        const controlPlaneAdminService = new ControlPlaneAdminService({
            pool: must(pool, "pool"),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const autoSafetyActionEngine = new AutoSafetyActionEngine({
            pool: must(pool, "pool"),
            controlPlaneAdminService,
            config: createDefaultAutoSafetyActionConfig(),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });
        const service = new QualificationSafetyAdminService({
            pool: must(pool, "pool"),
            autoSafetyActionEngine,
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
        });

        const evaluation = await autoSafetyActionEngine.evaluate({
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

        expect(evaluation.appliedAction?.id).toBeDefined();

        const unresolved = await service.listActions({ strategyKey, resolved: false });
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]?.resolvedAt).toBeNull();

        const resolved = await service.resolveAction(
            evaluation.appliedAction!.id,
            "operator acknowledged",
            "ops-admin@example.com"
        );
        expect(resolved.action.resolvedAt).not.toBeNull();
        expect(resolved.controlPlaneNote).toContain("no automatic rollback");

        const shardState = await must(pool, "pool").query<{ mode: string }>(
            `SELECT mode FROM planner_shard_state WHERE shard_id = $1`,
            [shardId]
        );
        expect(shardState.rows[0]?.mode).toBe("DISABLE_PHASE2B");
    });
});
