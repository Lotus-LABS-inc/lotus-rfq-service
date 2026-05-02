import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { QualificationRunManager } from "../../src/core/qualification/qualification-run-manager.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";

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

describe.skipIf(!ENV_READY)("QualificationRunManager integration", () => {
    let pool: Pool | undefined;
    const createdRunIds = new Set<string>();

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
        if (createdRunIds.size > 0) {
            await must(pool, "pool").query(
                `DELETE FROM strategy_qualification_runs WHERE id = ANY($1::uuid[])`,
                [[...createdRunIds]]
            );
        }

        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("persists the qualification run lifecycle and decision evaluations", async () => {
        const strategyKey = `phase3b.sor.${Date.now()}`;
        const scopeId = `bucket-${Date.now()}`;
        const manager = new QualificationRunManager({ pool: must(pool, "pool") });

        const created = await manager.createRun(
            strategyKey,
            "bucket",
            scopeId,
            QualificationStage.SHADOW,
            "eng-v1",
            "cfg-v1"
        );
        createdRunIds.add(created.id);

        expect(created.status).toBe(QualificationRunStatus.RUNNING);

        const evaluation = await manager.recordDecisionEvaluation(created.id, {
            decisionType: "SOR_PLAN",
            entityId: `rfq-${Date.now()}`,
            realizedMetrics: { fillRate: "0.91" },
            counterfactualMetrics: { fillRate: "0.89" },
            improvementMetrics: { liftBps: "2.0" }
        });

        expect(evaluation.qualificationRunId).toBe(created.id);

        const activeBeforeClose = await manager.listActiveRuns();
        expect(activeBeforeClose.some((run) => run.id === created.id)).toBe(true);

        const closed = await manager.closeRun(created.id, QualificationRunStatus.SUCCEEDED);
        expect(closed.status).toBe(QualificationRunStatus.SUCCEEDED);
        expect(closed.endedAt).not.toBeNull();

        const activeAfterClose = await manager.listActiveRuns();
        expect(activeAfterClose.some((run) => run.id === created.id)).toBe(false);

        const runRows = await must(pool, "pool").query<{
            stage: string;
            status: string;
            ended_at: Date | null;
        }>(
            `SELECT stage, status, ended_at
             FROM strategy_qualification_runs
             WHERE id = $1`,
            [created.id]
        );

        expect(runRows.rowCount).toBe(1);
        expect(runRows.rows[0]).toMatchObject({
            stage: "SHADOW",
            status: "SUCCEEDED"
        });
        expect(runRows.rows[0]?.ended_at).not.toBeNull();

        const evaluationRows = await must(pool, "pool").query<{
            qualification_run_id: string;
            decision_type: string;
            entity_id: string;
        }>(
            `SELECT qualification_run_id, decision_type, entity_id
             FROM strategy_decision_evaluations
             WHERE id = $1`,
            [evaluation.id]
        );

        expect(evaluationRows.rowCount).toBe(1);
        expect(evaluationRows.rows[0]).toEqual({
            qualification_run_id: created.id,
            decision_type: "SOR_PLAN",
            entity_id: evaluation.entityId
        });
    });
});
