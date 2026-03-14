import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  HistoricalMarketClass,
  HistoricalSimulationRunStatus,
  type HistoricalMarketState
} from "../../src/core/historical-simulation/historical-simulation.types.js";
import {
  HistoricalSimulationRunner,
  HistoricalSimulationRunnerError,
  type HistoricalLotusPathEvaluatorBundle,
  type HistoricalSimulationRunnerInput
} from "../../src/simulation/historical-simulation-runner.js";
import { BestExternalOnlyBaselineEvaluator } from "../../src/simulation/baselines/best-external-only-baseline.js";
import { LimitlessOnlyBaselineEvaluator } from "../../src/simulation/baselines/limitless-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../src/simulation/baselines/no-internalization-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "../../src/simulation/baselines/polymarket-only-baseline.js";

const createState = (overrides: Partial<HistoricalMarketState>): HistoricalMarketState => ({
  id: "state-1",
  canonicalEventId: "canonical-event-1",
  canonicalCategory: "OTHER",
  venue: "POLYMARKET",
  venueMarketId: "market-1",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  midpoint: null,
  bestBid: null,
  bestAsk: null,
  spread: null,
  lastPrice: "0.55",
  volume: "100",
  openInterest: "200",
  candles: null,
  orderbookSnapshot: null,
  marketEvents: null,
  trades: null,
  ownExecutionHistory: null,
  metadataVersion: "hist-v1",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
});

const createLotusEvaluators = (overrides?: Partial<HistoricalLotusPathEvaluatorBundle>): HistoricalLotusPathEvaluatorBundle => ({
  evaluateRFQGrouping: () => ({ grouped: true }),
  evaluateSOR: () => ({ route: "lotus-route" }),
  evaluateInternalCrossEligibility: () => ({ eligible: true }),
  evaluatePhase2ANettingEligibility: () => ({ eligible: true }),
  evaluateResolutionRiskGating: () => ({
    allowed: true,
    safeEquivalentEligible: true,
    reason: null
  }),
  evaluateFeeAdjustedLotusResult: () => ({
    effectiveCost: "0.52",
    slippage: "-0.03",
    fees: "0.00",
    fillProbability: "1",
    fillProbabilityReason: null,
    metadata: { source: "lotus" }
  }),
  ...overrides
});

const createMockPool = (states: readonly HistoricalMarketState[]) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM historical_market_states")) {
      return {
        rows: states.map((state) => ({
          id: state.id,
          canonical_event_id: state.canonicalEventId,
          canonical_category: state.canonicalCategory,
          venue: state.venue,
          venue_market_id: state.venueMarketId,
          market_class: state.marketClass,
          timestamp: state.timestamp,
          midpoint: state.midpoint,
          best_bid: state.bestBid,
          best_ask: state.bestAsk,
          spread: state.spread,
          last_price: state.lastPrice,
          volume: state.volume,
          open_interest: state.openInterest,
          candles: state.candles,
          orderbook_snapshot: state.orderbookSnapshot,
          market_events: state.marketEvents,
          trades: state.trades,
          own_execution_history: state.ownExecutionHistory,
          metadata_version: state.metadataVersion,
          source_timestamp: state.sourceTimestamp
        }))
      };
    }

    if (sql.includes("INSERT INTO historical_simulation_runs")) {
      return { rows: [{ id: "run-1", status: "RUNNING" }] };
    }

    if (sql.includes("INSERT INTO historical_simulation_results")) {
      return { rows: [{ id: `result-${query.mock.calls.length}` }] };
    }

    if (sql.includes("UPDATE historical_simulation_runs")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as unknown as Pool;
};

const createRunner = (pool: Pool, lotusEvaluators?: Partial<HistoricalLotusPathEvaluatorBundle>) =>
  new HistoricalSimulationRunner({
    pool,
    polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
    limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
    bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
    noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
    lotusEvaluators: createLotusEvaluators(lotusEvaluators)
  });

const createInput = (overrides?: Partial<HistoricalSimulationRunnerInput>): HistoricalSimulationRunnerInput => ({
  scopeType: "EVENT",
  scopeId: "event-1",
  venuePair: "POLYMARKET_LIMITLESS",
  marketClass: HistoricalMarketClass.BINARY,
  canonicalEventId: "canonical-event-1",
  windowStart: new Date("2026-03-13T00:00:00.000Z"),
  windowEnd: new Date("2026-03-13T00:10:00.000Z"),
  configVersion: "cfg-v1",
  engineVersion: "eng-v1",
  dryRun: true,
  ...overrides
});

describe("HistoricalSimulationRunner", () => {
  it("runs a deterministic sports-market dry run and computes all baselines", async () => {
    const pool = createMockPool([
      createState({
        id: "sports-poly",
        venue: "POLYMARKET",
        venueMarketId: "condition-sports",
        bestBid: "0.58",
        bestAsk: "0.60",
        orderbookSnapshot: { bids: [{ price: "0.58", size: "2" }], asks: [{ price: "0.60", size: "2" }] }
      }),
      createState({
        id: "sports-limitless",
        venue: "LIMITLESS",
        venueMarketId: "slug-sports",
        lastPrice: "0.57",
        ownExecutionHistory: {
          observedFilledCount: "4",
          observedOpportunityCount: "5"
        }
      })
    ]);
    const runner = createRunner(pool);

    const first = await runner.run(createInput());
    const second = await runner.run(createInput());

    expect(first.runId).toBeNull();
    expect(first.status).toBe(HistoricalSimulationRunStatus.SUCCEEDED);
    expect(first.sliceCount).toBe(1);
    expect(first.persistedResultCount).toBe(0);
    expect(first.sliceResults[0]?.baselineResults.polymarketOnly.baselineType).toBe("POLYMARKET_ONLY");
    expect(first.sliceResults[0]?.baselineResults.limitlessOnly.baselineType).toBe("LIMITLESS_ONLY");
    expect(first.sliceResults[0]?.baselineResults.bestExternalOnly.baselineType).toBe("BEST_EXTERNAL_ONLY");
    expect(first.sliceResults[0]?.baselineResults.noInternalization.baselineType).toBe("NO_INTERNALIZATION");
    expect(first.sliceResults[0]?.lotusResult.safeEquivalentEligible).toBe(true);
    expect(first).toEqual(second);
  });

  it("persists a crypto market simulation run and result rows", async () => {
    const pool = createMockPool([
      createState({
        id: "crypto-poly",
        timestamp: new Date("2026-03-13T00:00:00.000Z"),
        venue: "POLYMARKET",
        venueMarketId: "condition-crypto",
        bestBid: "0.47",
        bestAsk: "0.49",
        orderbookSnapshot: { bids: [{ price: "0.47", size: "3" }], asks: [{ price: "0.49", size: "3" }] }
      }),
      createState({
        id: "crypto-limitless",
        timestamp: new Date("2026-03-13T00:00:00.000Z"),
        venue: "LIMITLESS",
        venueMarketId: "slug-crypto",
        lastPrice: "0.48",
        ownExecutionHistory: {
          observedFilledCount: "3",
          observedOpportunityCount: "4"
        }
      })
    ]);
    const runner = createRunner(pool, {
      evaluateFeeAdjustedLotusResult: () => ({
        effectiveCost: "0.46",
        slippage: "-0.02",
        fees: "0.01",
        fillProbability: "0.75",
        fillProbabilityReason: null
      })
    });

    const result = await runner.run(createInput({ dryRun: false, scopeType: "MARKET", scopeId: "btc-2026" }));

    expect(result.runId).toBe("run-1");
    expect(result.persistedResultCount).toBe(1);
    expect(result.status).toBe(HistoricalSimulationRunStatus.SUCCEEDED);
    expect(result.sliceResults[0]?.persistedResultId).toBeTruthy();
    expect(result.sliceResults[0]?.lotusResult.feeAdjustedResult).toEqual(
      expect.objectContaining({ effectiveCost: "0.46", fillProbability: "0.75" })
    );
  });

  it("blocks Lotus pooled evaluation when SAFE_EQUIVALENT gating is denied and still computes baselines", async () => {
    const pool = createMockPool([
      createState({
        id: "blocked-poly",
        venue: "POLYMARKET",
        venueMarketId: "condition-blocked",
        bestBid: "0.40",
        bestAsk: "0.42",
        orderbookSnapshot: { bids: [{ price: "0.40", size: "1" }], asks: [{ price: "0.42", size: "1" }] }
      }),
      createState({
        id: "blocked-limitless",
        venue: "LIMITLESS",
        venueMarketId: "slug-blocked",
        lastPrice: "0.41"
      })
    ]);
    const runner = createRunner(pool, {
      evaluateResolutionRiskGating: () => ({
        allowed: false,
        safeEquivalentEligible: false,
        reason: "not_safe_equivalent"
      })
    });

    const result = await runner.run(createInput());

    expect(result.blockedSliceCount).toBe(1);
    expect(result.sliceResults[0]?.rolloutEligibility).toEqual({
      reason: "not_safe_equivalent",
      safeEquivalentEligible: false,
      status: "BLOCKED"
    });
    expect(result.sliceResults[0]?.lotusResult.metadata).toEqual({
      blocked: true,
      blockedReason: "not_safe_equivalent"
    });
    expect(result.sliceResults[0]?.baselineResults.bestExternalOnly).toBeDefined();
  });

  it("fails closed when no historical states exist in the requested window", async () => {
    const pool = createMockPool([]);
    const runner = createRunner(pool);

    await expect(runner.run(createInput())).rejects.toMatchObject({
      code: "historical_state_missing"
    });
  });

  it("fails construction when a Lotus evaluator dependency is missing", () => {
    const pool = createMockPool([]);

    expect(
      () =>
        new HistoricalSimulationRunner({
          pool,
          polymarketOnlyBaselineEvaluator: new PolymarketOnlyBaselineEvaluator(),
          limitlessOnlyBaselineEvaluator: new LimitlessOnlyBaselineEvaluator(),
          bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
          noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
          lotusEvaluators: {
            ...createLotusEvaluators(),
            evaluateSOR: undefined as unknown as HistoricalLotusPathEvaluatorBundle["evaluateSOR"]
          }
        })
    ).toThrowError(HistoricalSimulationRunnerError);
  });
});
