import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
    QualificationMetricsRollup,
    type QualificationMetricsRollupConfig
} from "../../src/core/qualification/qualification-metrics-rollup.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const config: QualificationMetricsRollupConfig = {
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

describe.skipIf(!ENV_READY)("QualificationMetricsRollup integration", () => {
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

    it("refreshes and reads grouped rollups with readiness scoring", async () => {
        const strategyKey = `phase3b.rollup.${Date.now()}`;

        const runInsert = await must(pool, "pool").query<{ id: string }>(
            `INSERT INTO strategy_qualification_runs (strategy_key, scope_type, scope_id, stage, engine_version, config_version, status, metadata)
             VALUES ($1, 'MARKET', 'market-rollup', 'SHADOW', 'eng-v1', 'cfg-v1', 'RUNNING', '{}'::jsonb)
             RETURNING id`,
            [strategyKey]
        );
        const runId = runInsert.rows[0]!.id;
        runIds.add(runId);

        await must(pool, "pool").query(
            `INSERT INTO strategy_decision_evaluations
                (qualification_run_id, decision_type, entity_id, realized_metrics, counterfactual_metrics, improvement_metrics)
             VALUES
                ($1, 'SOR_CONFIG_CHANGE', 'entity-1', $2::jsonb, $3::jsonb, $4::jsonb),
                ($1, 'PHASE2B_CLEARING_STRATEGY_CHANGE', 'entity-2', $5::jsonb, $6::jsonb, $7::jsonb),
                ($1, 'SOR_CONFIG_CHANGE', 'entity-ignored', $8::jsonb, $9::jsonb, $10::jsonb)`,
            [
                runId,
                JSON.stringify({
                    market: "market-rollup",
                    venuePair: "venue-a->venue-b",
                    externalNotional: "70",
                    internalizedNotional: "20",
                    compressionNotional: "10",
                    adverseSelectionIndicator: "0.05"
                }),
                JSON.stringify({
                    market: "market-rollup",
                    venuePair: "venue-a->venue-b"
                }),
                JSON.stringify({
                    feeSaved: "1.5",
                    slippageSaved: "0.5",
                    priceImprovement: "0.2"
                }),
                JSON.stringify({
                    market: "market-rollup",
                    venuePair: "venue-a->venue-b",
                    externalNotional: "30",
                    internalizedNotional: "10",
                    compressionNotional: "5",
                    adverseSelectionIndicator: "0.15"
                }),
                JSON.stringify({
                    market: "market-rollup",
                    venuePair: "venue-a->venue-b"
                }),
                JSON.stringify({
                    feeSaved: "0.5",
                    slippageSaved: "0.25",
                    priceImprovement: "0.1"
                }),
                JSON.stringify({
                    externalNotional: "999",
                    internalizedNotional: "999"
                }),
                JSON.stringify({}),
                JSON.stringify({
                    feeSaved: "99",
                    slippageSaved: "99",
                    priceImprovement: "99"
                })
            ]
        );

        const rollup = new QualificationMetricsRollup(must(pool, "pool"), config);
        await rollup.refresh();

        const rows = await rollup.list({ strategyKey, market: "market-rollup", venuePair: "venue-a->venue-b" });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            strategyKey,
            market: "market-rollup",
            venuePair: "venue-a->venue-b",
            evaluationCount: 2,
            externalNotionalTotal: "100",
            internalizedNotionalTotal: "30",
            compressionNotionalTotal: "15",
            feeSavings: "2",
            slippageSavings: "0.75",
            fillQualityDelta: "0.15"
        });
        expect(rows[0]?.internalizationRate).toBe("0.23076923076923076923");
        expect(rows[0]?.compressionRatio).toBe("0.11538461538461538462");
        expect(rows[0]?.adverseSelectionIndicator).toBe("0.1");
        expect(rows[0]?.promotionReadinessScoreVersion).toBe("rollup-v1");
        expect(rows[0]?.promotionReadinessScore).toBeGreaterThan(0);

        const exact = await rollup.get({
            strategyKey,
            scopeType: "MARKET",
            scopeId: "market-rollup",
            stage: "SHADOW",
            engineVersion: "eng-v1",
            configVersion: "cfg-v1",
            market: "market-rollup",
            venuePair: "venue-a->venue-b"
        });
        expect(exact?.evaluationCount).toBe(2);
    });
});
