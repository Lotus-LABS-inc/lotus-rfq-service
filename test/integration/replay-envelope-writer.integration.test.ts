import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ReplayEnvelopeWriter, stableJsonSerialize } from "../../src/core/replay/replay-envelope-writer.js";

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

describe.skipIf(!ENV_READY)("ReplayEnvelopeWriter integration", () => {
    let pool: Pool | undefined;
    const createdEnvelopeIds = new Set<string>();

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
        if (createdEnvelopeIds.size > 0) {
            await must(pool, "pool").query(`DELETE FROM replay_envelopes WHERE id = ANY($1::uuid[])`, [[...createdEnvelopeIds]]);
        }

        if (pool) {
            await pool.end();
        }
    }, 180000);

    it("persists envelope rows with stable logically identical JSON snapshots", async () => {
        const writer = new ReplayEnvelopeWriter({ pool: must(pool, "pool") });
        const sharedEntityId = `entity-${randomUUID()}`;

        const first = await writer.write({
            decisionType: "SOR_PLAN",
            entityId: sharedEntityId,
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: { beta: true, alpha: false },
            inputSnapshot: { b: 2, a: 1 },
            decisionTrace: { selected: { z: 2, a: 1 } },
            outputSnapshot: { plan: ["venue-a", "venue-b"] }
        });

        const second = await writer.write({
            decisionType: "SOR_PLAN",
            entityId: sharedEntityId,
            correlationId: `corr-${randomUUID()}`,
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            featureFlags: { alpha: false, beta: true },
            inputSnapshot: { a: 1, b: 2 },
            decisionTrace: { selected: { a: 1, z: 2 } },
            outputSnapshot: { plan: ["venue-a", "venue-b"] }
        });

        createdEnvelopeIds.add(first.id);
        createdEnvelopeIds.add(second.id);

        const persisted = await must(pool, "pool").query<{
            id: string;
            feature_flags: Record<string, unknown>;
            input_snapshot: Record<string, unknown>;
            decision_trace: Record<string, unknown>;
            output_snapshot: Record<string, unknown>;
        }>(
            `SELECT id, feature_flags, input_snapshot, decision_trace, output_snapshot
               FROM replay_envelopes
              WHERE id = ANY($1::uuid[])
              ORDER BY created_at ASC`,
            [[first.id, second.id]]
        );

        expect(persisted.rowCount).toBe(2);
        expect(stableJsonSerialize(persisted.rows[0]?.feature_flags)).toBe(stableJsonSerialize(persisted.rows[1]?.feature_flags));
        expect(stableJsonSerialize(persisted.rows[0]?.input_snapshot)).toBe(stableJsonSerialize(persisted.rows[1]?.input_snapshot));
        expect(stableJsonSerialize(persisted.rows[0]?.decision_trace)).toBe(stableJsonSerialize(persisted.rows[1]?.decision_trace));
        expect(stableJsonSerialize(persisted.rows[0]?.output_snapshot)).toBe(stableJsonSerialize(persisted.rows[1]?.output_snapshot));
    });
});
