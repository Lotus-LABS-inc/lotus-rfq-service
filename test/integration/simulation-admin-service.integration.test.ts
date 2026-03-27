import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { SimulationAdminService } from "../../src/api/admin/simulation-admin-service.js";

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

describe.skipIf(!ENV_READY)("SimulationAdminService integration", () => {
  let pool: Pool | undefined;
  const canonicalEventId = "77777777-7777-4777-8777-777777777777";
  const runId = "88888888-8888-4888-8888-888888888888";

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM historical_simulation_results WHERE run_id = $1`, [runId]);
      await pool.query(`DELETE FROM historical_simulation_runs WHERE id = $1`, [runId]);
      await pool.query(`DELETE FROM historical_market_states WHERE canonical_event_id = $1`, [canonicalEventId]);
      await pool.end();
    }
  }, 180000);

  it("lists category-aware scopes and returns canonical coverage with resolution-risk inspection", async () => {
    await pool!.query(
      `INSERT INTO historical_market_states (
         canonical_event_id,
         canonical_category,
         venue,
         venue_market_id,
         market_class,
         "timestamp",
         last_price,
         metadata_version,
         source_timestamp
       ) VALUES
       ($1, 'SPORTS', 'POLYMARKET', 'sports-poly', 'BINARY', $2, '0.55', 'hist-v1', $2),
       ($1, 'SPORTS', 'LIMITLESS', 'sports-limitless', 'BINARY', $2, '0.54', 'hist-v1', $2)`,
      [canonicalEventId, new Date("2026-03-13T00:00:00.000Z")]
    );

    await pool!.query(
      `INSERT INTO historical_simulation_runs (
         id,
         qualification_run_id,
         scope_type,
         scope_id,
         venue_pair,
         market_class,
         status,
         metadata
       ) VALUES ($1, NULL, 'CANONICAL_EVENT', $2, 'POLYMARKET_LIMITLESS', 'BINARY', 'SUCCEEDED', '{"strategyKey":"strategy.sim.v1"}'::jsonb)`,
      [runId, canonicalEventId]
    );

    await pool!.query(
      `INSERT INTO historical_simulation_results (
         run_id,
         canonical_event_id,
         "timestamp",
         baseline_results,
         lotus_result,
         improvement,
         rollout_eligibility
       ) VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
      [runId, canonicalEventId, new Date("2026-03-13T00:00:00.000Z")]
    );

    const service = new SimulationAdminService({
      pool: pool!,
      historicalSimulationRunner: {
        run: async () => ({
          runId,
          dryRun: false,
          status: HistoricalSimulationRunStatus.SUCCEEDED,
          sliceResults: [],
          sliceCount: 0,
          persistedResultCount: 0,
          blockedSliceCount: 0,
          metadata: {}
        })
      },
      resolutionRiskAdminService: {
        getCanonicalInspection: async (eventId: string) => ({
          canonicalEventId: eventId,
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 0,
            expectedPairCount: 0,
            persistedPairCount: 0,
            lastComputedAt: null,
            latestProfileUpdatedAt: null,
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        })
      },
      historicalSimulationCatalogService: {
        hasCanonicalEvent: async () => false,
        getCanonicalInspection: async (eventId: string) => ({
          canonicalEventId: eventId,
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 0,
            expectedPairCount: 0,
            persistedPairCount: 0,
            lastComputedAt: null,
            latestProfileUpdatedAt: null,
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        })
      },
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const scopes = await service.listScopes({ category: "SPORTS", marketClass: HistoricalMarketClass.BINARY });
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.canonicalEventId).toBe(canonicalEventId);

    const run = await service.getRun(runId);
    expect(run.id).toBe(runId);

    const results = await service.listRunResults(runId);
    expect(results).toHaveLength(1);

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    expect(coverage.canonicalCategory).toBe("SPORTS");
    expect(coverage.venueCoverage).toHaveLength(2);
    expect(coverage.resolutionRiskInspection.canonicalEventId).toBe(canonicalEventId);
  }, 30000);
});
