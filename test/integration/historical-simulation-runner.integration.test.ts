import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput
} from "../../src/core/historical-simulation/historical-simulation.types.js";
import {
  HistoricalSimulationRunner,
  type HistoricalLotusPathEvaluatorBundle
} from "../../src/simulation/historical-simulation-runner.js";
import { BestExternalOnlyBaselineEvaluator } from "../../src/simulation/baselines/best-external-only-baseline.js";
import { LimitlessOnlyBaselineEvaluator } from "../../src/simulation/baselines/limitless-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../src/simulation/baselines/no-internalization-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "../../src/simulation/baselines/polymarket-only-baseline.js";

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

const createState = (overrides: Partial<CreateHistoricalMarketStateInput>): CreateHistoricalMarketStateInput => ({
  canonicalEventId: "phase4-runner-sports",
  canonicalCategory: "SPORTS",
  venue: "POLYMARKET",
  venueMarketId: "market-1",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  lastPrice: "0.50",
  metadataVersion: "hist-v1",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
});

const insertStates = async (pool: Pool, states: readonly CreateHistoricalMarketStateInput[]): Promise<void> => {
  for (const state of states) {
    await pool.query(
      `INSERT INTO historical_market_states (
         canonical_event_id,
         canonical_category,
         venue,
         venue_market_id,
         market_class,
         "timestamp",
         midpoint,
         best_bid,
         best_ask,
         spread,
         last_price,
         volume,
         open_interest,
         candles,
         orderbook_snapshot,
         market_events,
         trades,
         own_execution_history,
         metadata_version,
         source_timestamp
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20
       )`,
      [
        state.canonicalEventId,
        state.canonicalCategory ?? null,
        state.venue,
        state.venueMarketId,
        state.marketClass,
        state.timestamp,
        state.midpoint ?? null,
        state.bestBid ?? null,
        state.bestAsk ?? null,
        state.spread ?? null,
        state.lastPrice ?? null,
        state.volume ?? null,
        state.openInterest ?? null,
        state.candles ? JSON.stringify(state.candles) : null,
        state.orderbookSnapshot ? JSON.stringify(state.orderbookSnapshot) : null,
        state.marketEvents ? JSON.stringify(state.marketEvents) : null,
        state.trades ? JSON.stringify(state.trades) : null,
        state.ownExecutionHistory ? JSON.stringify(state.ownExecutionHistory) : null,
        state.metadataVersion,
        state.sourceTimestamp
      ]
    );
  }
};

const createLotusEvaluators = (): HistoricalLotusPathEvaluatorBundle => ({
  evaluateRFQGrouping: () => ({ grouped: true }),
  evaluateSOR: () => ({ route: "historical-sor" }),
  evaluateInternalCrossEligibility: () => ({ eligible: true }),
  evaluatePhase2ANettingEligibility: () => ({ eligible: true }),
  evaluateResolutionRiskGating: () => ({
    allowed: true,
    safeEquivalentEligible: true,
    reason: null
  }),
  evaluateFeeAdjustedLotusResult: () => ({
    effectiveCost: "0.45",
    slippage: "-0.02",
    fees: "0.01",
    fillProbability: "0.90",
    fillProbabilityReason: null
  })
});

describe.skipIf(!ENV_READY)("HistoricalSimulationRunner integration", () => {
  let pool: Pool | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(pool);
  }, 180000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM historical_simulation_runs WHERE scope_id LIKE 'phase4-runner-%'`);
      await pool.query(`DELETE FROM historical_market_states WHERE canonical_event_id LIKE 'phase4-runner-%'`);
      await pool.end();
    }
  }, 180000);

  it("persists a successful sports simulation run and result row", async () => {
    const runner = new HistoricalSimulationRunner({
      pool: pool as Pool,
      polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
      limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
      bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
      noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
      lotusEvaluators: createLotusEvaluators()
    });

    await insertStates(pool as Pool, [
      createState({
        canonicalEventId: "phase4-runner-sports",
        venue: "POLYMARKET",
        venueMarketId: "sports-poly",
        bestBid: "0.58",
        bestAsk: "0.60",
        orderbookSnapshot: { bids: [{ price: "0.58", size: "2" }], asks: [{ price: "0.60", size: "2" }] }
      }),
      createState({
        canonicalEventId: "phase4-runner-sports",
        venue: "LIMITLESS",
        venueMarketId: "sports-limitless",
        lastPrice: "0.57",
        ownExecutionHistory: {
          observedFilledCount: "4",
          observedOpportunityCount: "5"
        }
      })
    ]);

    const result = await runner.run({
      scopeType: "EVENT",
      scopeId: "phase4-runner-sports-scope",
      venuePair: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "phase4-runner-sports",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:05:00.000Z"),
      configVersion: "cfg-v1",
      engineVersion: "eng-v1",
      dryRun: false
    });

    expect(result.runId).not.toBeNull();
    expect(result.persistedResultCount).toBe(1);

    const runRows = await (pool as Pool).query<{ status: string; ended_at: Date | null }>(
      `SELECT status, ended_at
         FROM historical_simulation_runs
        WHERE id = $1`,
      [result.runId]
    );
    expect(runRows.rows[0]?.status).toBe("SUCCEEDED");
    expect(runRows.rows[0]?.ended_at).not.toBeNull();

    const resultRows = await (pool as Pool).query<{ baseline_results: Record<string, unknown>; lotus_result: Record<string, unknown> }>(
      `SELECT baseline_results, lotus_result
         FROM historical_simulation_results
        WHERE run_id = $1`,
      [result.runId]
    );
    expect(resultRows.rowCount).toBe(1);
    expect(resultRows.rows[0]?.baseline_results).toHaveProperty("bestExternalOnly");
    expect(resultRows.rows[0]?.lotus_result).toHaveProperty("feeAdjustedResult");
  });

  it("persists crypto slice results across multiple timestamps and leaves dry-run tables unchanged", async () => {
    const runner = new HistoricalSimulationRunner({
      pool: pool as Pool,
      polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
      limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
      bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
      noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
      lotusEvaluators: createLotusEvaluators()
    });

    await insertStates(pool as Pool, [
      createState({
        canonicalEventId: "phase4-runner-crypto",
        timestamp: new Date("2026-03-13T01:00:00.000Z"),
        sourceTimestamp: new Date("2026-03-13T01:00:00.000Z"),
        venue: "POLYMARKET",
        venueMarketId: "crypto-poly",
        bestBid: "0.46",
        bestAsk: "0.48",
        orderbookSnapshot: { bids: [{ price: "0.46", size: "3" }], asks: [{ price: "0.48", size: "3" }] }
      }),
      createState({
        canonicalEventId: "phase4-runner-crypto",
        timestamp: new Date("2026-03-13T01:00:00.000Z"),
        sourceTimestamp: new Date("2026-03-13T01:00:00.000Z"),
        venue: "LIMITLESS",
        venueMarketId: "crypto-limitless",
        lastPrice: "0.47",
        ownExecutionHistory: {
          observedFilledCount: "2",
          observedOpportunityCount: "3"
        }
      }),
      createState({
        canonicalEventId: "phase4-runner-crypto",
        timestamp: new Date("2026-03-13T01:05:00.000Z"),
        sourceTimestamp: new Date("2026-03-13T01:05:00.000Z"),
        venue: "POLYMARKET",
        venueMarketId: "crypto-poly",
        bestBid: "0.49",
        bestAsk: "0.51",
        orderbookSnapshot: { bids: [{ price: "0.49", size: "2" }], asks: [{ price: "0.51", size: "2" }] }
      }),
      createState({
        canonicalEventId: "phase4-runner-crypto",
        timestamp: new Date("2026-03-13T01:05:00.000Z"),
        sourceTimestamp: new Date("2026-03-13T01:05:00.000Z"),
        venue: "LIMITLESS",
        venueMarketId: "crypto-limitless",
        lastPrice: "0.50",
        ownExecutionHistory: {
          observedFilledCount: "3",
          observedOpportunityCount: "4"
        }
      })
    ]);

    const persisted = await runner.run({
      scopeType: "EVENT",
      scopeId: "phase4-runner-crypto-scope",
      venuePair: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "phase4-runner-crypto",
      windowStart: new Date("2026-03-13T01:00:00.000Z"),
      windowEnd: new Date("2026-03-13T01:10:00.000Z"),
      configVersion: "cfg-v2",
      engineVersion: "eng-v2",
      dryRun: false
    });

    expect(persisted.sliceCount).toBe(2);
    expect(persisted.persistedResultCount).toBe(2);

    const countsBeforeDryRun = await (pool as Pool).query<{ runs: string; results: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM historical_simulation_runs WHERE scope_id = 'phase4-runner-crypto-dryrun') AS runs,
         (SELECT COUNT(*)::text FROM historical_simulation_results) AS results`
    );

    const dryRun = await runner.run({
      scopeType: "EVENT",
      scopeId: "phase4-runner-crypto-dryrun",
      venuePair: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "phase4-runner-crypto",
      windowStart: new Date("2026-03-13T01:00:00.000Z"),
      windowEnd: new Date("2026-03-13T01:10:00.000Z"),
      configVersion: "cfg-v2",
      engineVersion: "eng-v2",
      dryRun: true
    });

    const countsAfterDryRun = await (pool as Pool).query<{ runs: string; results: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM historical_simulation_runs WHERE scope_id = 'phase4-runner-crypto-dryrun') AS runs,
         (SELECT COUNT(*)::text FROM historical_simulation_results) AS results`
    );

    expect(dryRun.runId).toBeNull();
    expect(countsBeforeDryRun.rows[0]).toEqual(countsAfterDryRun.rows[0]);
  });
});
