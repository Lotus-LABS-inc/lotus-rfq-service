import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { HistoricalMarketClass } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";

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

describe.skipIf(!ENV_READY)("HistoricalMarketStateRepository integration", () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM historical_market_states WHERE canonical_event_id LIKE 'phase4-historical-%'`);
      await pool.end();
    }
  }, 180000);

  it("prevents duplicate inserts and returns the latest source timestamp", async () => {
    const repository = new HistoricalMarketStateRepository(pool as Pool);
    const state = {
      canonicalEventId: `phase4-historical-${Date.now()}`,
      venue: "POLYMARKET",
      venueMarketId: "condition-1",
      marketClass: HistoricalMarketClass.BINARY,
      timestamp: new Date("2026-03-13T00:00:00.000Z"),
      lastPrice: "0.55",
      metadataVersion: "predexon-v2",
      sourceTimestamp: new Date("2026-03-13T00:00:01.000Z")
    };

    const first = await repository.insertManyIgnoreDuplicates([state]);
    const second = await repository.insertManyIgnoreDuplicates([state]);

    expect(first).toEqual({ inserted: 1, skipped: 0 });
    expect(second).toEqual({ inserted: 0, skipped: 1 });

    const latest = await repository.getLatestSourceTimestamp({
      venue: "POLYMARKET",
      venueMarketId: "condition-1",
      metadataVersion: "predexon-v2"
    });

    expect(latest?.toISOString()).toBe("2026-03-13T00:00:01.000Z");
  });
});
