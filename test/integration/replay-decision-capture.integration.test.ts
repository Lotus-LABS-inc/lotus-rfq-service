import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ReplayDecisionCaptureService } from "../../src/core/replay/replay-decision-capture-service.js";
import { ReplayEnvelopeWriter } from "../../src/core/replay/replay-envelope-writer.js";

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

describe.skipIf(!ENV_READY)("replay decision capture integration", () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 180000);

  it("persists replay envelopes through the shared capture facade", async () => {
    const writer = new ReplayEnvelopeWriter({ pool: pool! });
    const service = new ReplayDecisionCaptureService(writer, {
      error: () => undefined,
      warn: () => undefined
    });

    const correlationId = `replay-capture-${Date.now()}`;
    const persisted = await service.capture({
      config: {
        mode: "REQUIRED",
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        featureFlags: { replay: true }
      },
      buildEnvelope: () => ({
        decisionType: "RFQ_GROUPING",
        entityId: "rfq-capture-1",
        correlationId,
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        featureFlags: { replay: true },
        inputSnapshot: { rfqId: "rfq-capture-1" },
        decisionTrace: { pairGenerationOrder: ["a|b"] },
        outputSnapshot: { grouping: { safePools: [["a", "b"]] } }
      })
    });

    expect(persisted).not.toBeNull();

    const rows = await pool!.query<{
      decision_type: string;
      entity_id: string;
      correlation_id: string;
      config_version: string;
      engine_version: string;
    }>(
      `SELECT decision_type, entity_id, correlation_id, config_version, engine_version
         FROM replay_envelopes
        WHERE correlation_id = $1`,
      [correlationId]
    );

    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({
      decision_type: "RFQ_GROUPING",
      entity_id: "rfq-capture-1",
      correlation_id: correlationId,
      config_version: "cfg-v1",
      engine_version: "eng-v1"
    });

    await pool!.query(`DELETE FROM replay_envelopes WHERE correlation_id = $1`, [correlationId]);
  });
});
