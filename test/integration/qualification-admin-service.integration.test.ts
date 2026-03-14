import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { QualificationAdminService, createDefaultPromotionGateConfig } from "../../src/api/admin/qualification-admin-service.js";
import { PromotionGateEvaluator } from "../../src/core/qualification/promotion-gate-evaluator.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";

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

describe.skipIf(!ENV_READY)("QualificationAdminService integration", () => {
    let pool: Pool | undefined;
    const runIds = new Set<string>();
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
            await must(pool, "pool").query(`DELETE FROM strategy_promotion_events WHERE strategy_key = ANY($1::text[])`, [[...strategyKeys]]);
        }
        if (runIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM strategy_qualification_runs WHERE id = ANY($1::uuid[])`, [[...runIds]]);
        }
        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("promotes, demotes, pauses, and aggregates run detail from persisted evaluations", async () => {
        const strategyKey = `phase3b.admin.${Date.now()}`;
        strategyKeys.add(strategyKey);

        const runInsert = await must(pool, "pool").query<{ id: string }>(
            `INSERT INTO strategy_qualification_runs (strategy_key, scope_type, scope_id, stage, engine_version, config_version, status, metadata)
             VALUES ($1, 'bucket', 'bucket-admin', 'SHADOW', 'eng-v1', 'cfg-v1', 'RUNNING', $2::jsonb)
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
        const runId = runInsert.rows[0]!.id;
        runIds.add(runId);

        await must(pool, "pool").query(
            `INSERT INTO strategy_decision_evaluations (qualification_run_id, decision_type, entity_id, realized_metrics, counterfactual_metrics, improvement_metrics)
             VALUES ($1, 'SOR_CONFIG_CHANGE', 'rfq-1', $2::jsonb, $3::jsonb, $4::jsonb)`,
            [
                runId,
                JSON.stringify({ realizedFillPrice: "1.01" }),
                JSON.stringify({ realizedFillPrice: "1.02" }),
                JSON.stringify({
                    priceImprovement: "0.05",
                    slippageSaved: "0.05",
                    feeSaved: "0.02",
                    externalNotionalAvoided: "3",
                    internalizationGain: "3",
                    compressionGain: "1"
                })
            ]
        );

        const service = new QualificationAdminService({
            pool: must(pool, "pool"),
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const detail = await service.getRunDetail(runId);
        expect(detail.summary.evaluationCount).toBe(1);
        expect(detail.summary.improvement.numericTotals.priceImprovement).toBe("0.05");

        const promoted = await service.promoteRun(runId, "admin@example.com");
        expect(promoted.run.stage).toBe(QualificationStage.CANARY);

        const demoted = await service.demoteRun(runId, QualificationStage.SHADOW, "manual correction", "admin@example.com");
        expect(demoted.run.stage).toBe(QualificationStage.SHADOW);

        const paused = await service.pauseRun(runId, "hold", "admin@example.com");
        expect(paused.run.status).toBe(QualificationRunStatus.PAUSED);

        const eventRows = await must(pool, "pool").query<{ from_stage: string; to_stage: string }>(
            `SELECT from_stage, to_stage
             FROM strategy_promotion_events
             WHERE strategy_key = $1
             ORDER BY created_at ASC`,
            [strategyKey]
        );
        expect(eventRows.rowCount).toBe(2);
        expect(eventRows.rows[0]).toEqual({ from_stage: "SHADOW", to_stage: "CANARY" });
        expect(eventRows.rows[1]).toEqual({ from_stage: "CANARY", to_stage: "SHADOW" });

        const pausedRow = await must(pool, "pool").query<{ status: string }>(
            `SELECT status
             FROM strategy_qualification_runs
             WHERE id = $1`,
            [runId]
        );
        expect(pausedRow.rows[0]?.status).toBe("PAUSED");
    }, 30000);
});
