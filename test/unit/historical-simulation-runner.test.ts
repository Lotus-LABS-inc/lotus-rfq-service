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
import { createDefaultHistoricalLotusEvaluators } from "../../src/simulation/default-historical-lotus-evaluators.js";
import { LimitlessOnlyBaselineEvaluator } from "../../src/simulation/baselines/limitless-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "../../src/simulation/baselines/myriad-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../src/simulation/baselines/no-internalization-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "../../src/simulation/baselines/opinion-only-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "../../src/simulation/baselines/polymarket-only-baseline.js";

const createState = (overrides: Partial<HistoricalMarketState>): HistoricalMarketState => ({
  id: "state-1",
  canonicalEventId: "canonical-event-1",
  canonicalMarketId: null,
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
  ...createDefaultHistoricalLotusEvaluators(),
  evaluateResolutionRiskGating: () => ({
    allowed: true,
    safeEquivalentEligible: true,
    reason: null,
    metadata: { source: "unit-test" }
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
          canonical_market_id: state.canonicalMarketId,
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
    opinionOnlyBaselineEvaluator: new OpinionOnlyBaselineEvaluator(),
    myriadOnlyBaselineEvaluator: new MyriadOnlyBaselineEvaluator(),
    bestExternalOnlyBaselineEvaluator: new BestExternalOnlyBaselineEvaluator(),
    noInternalizationBaselineEvaluator: new NoInternalizationBaselineEvaluator(),
    lotusEvaluators: createLotusEvaluators(lotusEvaluators)
  });

const createInput = (overrides?: Partial<HistoricalSimulationRunnerInput>): HistoricalSimulationRunnerInput => ({
  scopeType: "EVENT",
  scopeId: "event-1",
  routeMode: "POLYMARKET_LIMITLESS",
  marketClass: HistoricalMarketClass.BINARY,
  canonicalEventId: "canonical-event-1",
  side: "BUY",
  requestedNotional: "100",
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
    expect(first.sliceResults[0]?.baselineResults.opinionOnly).toBeNull();
    expect(first.sliceResults[0]?.baselineResults.myriadOnly).toBeNull();
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

  it("evaluates a tri-venue slice and exposes an Opinion baseline", async () => {
    const pool = createMockPool([
      createState({
        id: "tri-poly",
        canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
        venue: "POLYMARKET",
        venueMarketId: "condition-crypto",
        bestBid: "0.47",
        bestAsk: "0.49",
        orderbookSnapshot: { bids: [{ price: "0.47", size: "3" }], asks: [{ price: "0.49", size: "3" }] }
      }),
      createState({
        id: "tri-limitless",
        canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
        venue: "LIMITLESS",
        venueMarketId: "slug-crypto",
        lastPrice: "0.48",
        ownExecutionHistory: {
          observedFilledCount: "3",
          observedOpportunityCount: "4"
        }
      }),
      createState({
        id: "tri-opinion",
        canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
        venue: "OPINION",
        venueMarketId: "opinion-crypto",
        midpoint: "0.475",
        lastPrice: "0.475"
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({
      routeMode: "POLYMARKET_LIMITLESS_OPINION",
      canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS"
    }));

    expect(result.sliceResults[0]?.baselineResults.opinionOnly).toEqual(
      expect.objectContaining({
        venue: "OPINION",
        baselineType: "OPINION_ONLY",
        effectiveCost: "100"
      })
    );
    expect(result.sliceResults[0]?.improvement.venueSpecific).toEqual(
      expect.objectContaining({
        opinionOnly: expect.objectContaining({
          baselineVenue: "OPINION",
          baselineType: "OPINION_ONLY"
        })
      })
    );
  });

  it("supports simulation-only single-venue routes without forcing missing-venue baselines", async () => {
    const pool = createMockPool([
      createState({
        id: "histsim-opinion-only",
        canonicalEventId: "HISTSIM::demo-opinion-market",
        canonicalMarketId: "HISTSIM-demo-opinion-market",
        canonicalCategory: "POLITICS",
        venue: "OPINION",
        venueMarketId: "6808",
        bestAsk: "0.744",
        lastPrice: "0.744",
        orderbookSnapshot: { asks: [{ price: "0.744", size: "360.9" }], bids: [] }
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({
      routeMode: "OPINION_ONLY",
      canonicalEventId: "HISTSIM::demo-opinion-market",
      canonicalMarketId: "HISTSIM-demo-opinion-market"
    }));

    expect(result.status).toBe(HistoricalSimulationRunStatus.SUCCEEDED);
    expect(result.sliceResults[0]?.baselineResults.polymarketOnly).toBeNull();
    expect(result.sliceResults[0]?.baselineResults.limitlessOnly).toBeNull();
    expect(result.sliceResults[0]?.baselineResults.opinionOnly).toEqual(
      expect.objectContaining({
        venue: "OPINION",
        baselineType: "OPINION_ONLY"
      })
    );
    expect(result.sliceResults[0]?.baselineResults.myriadOnly).toBeNull();
    expect(result.sliceResults[0]?.improvement.venueSpecific).toEqual(
      expect.not.objectContaining({
        polymarketOnly: expect.anything(),
        limitlessOnly: expect.anything()
      })
    );
  });

  it("supports Myriad-only simulation from conservative price and event evidence", async () => {
    const pool = createMockPool([
      createState({
        id: "myriad-only",
        canonicalEventId: "myriad-event-1",
        canonicalMarketId: "MYRIAD-POLITICS-DEMO-MARKET",
        canonicalCategory: "POLITICS",
        venue: "MYRIAD",
        venueMarketId: "myriad-market-1",
        lastPrice: "0.61",
        candles: {
          source: "MYRIAD",
          depthModel: "amm_conservative"
        },
        marketEvents: {
          events: [
            { action: "buy", value: 80, shares: 120 }
          ]
        }
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({
      routeMode: "MYRIAD_ONLY",
      canonicalEventId: "myriad-event-1",
      canonicalMarketId: "MYRIAD-POLITICS-DEMO-MARKET"
    }));

    expect(result.status).toBe(HistoricalSimulationRunStatus.SUCCEEDED);
    expect(result.sliceResults[0]?.baselineResults.myriadOnly).toEqual(
      expect.objectContaining({
        venue: "MYRIAD",
        baselineType: "MYRIAD_ONLY",
        fillProbabilityReason: "event_capped_conservative"
      })
    );
    expect(result.sliceResults[0]?.baselineResults.bestExternalOnly).toEqual(
      expect.objectContaining({
        venue: "MYRIAD"
      })
    );
  });

  it("changes venue preference for BUY vs SELL when bid/ask differ", async () => {
    const states = [
      createState({
        id: "buy-sell-poly",
        venue: "POLYMARKET",
        venueMarketId: "poly-market",
        bestBid: "0.62",
        bestAsk: "0.68",
        orderbookSnapshot: { bids: [{ price: "0.62", size: "500" }], asks: [{ price: "0.68", size: "500" }] }
      }),
      createState({
        id: "buy-sell-limitless",
        venue: "LIMITLESS",
        venueMarketId: "limitless-market",
        bestBid: "0.59",
        bestAsk: "0.64",
        lastPrice: "0.615"
      })
    ];
    const pool = createMockPool(states);
    const runner = createRunner(pool);

    const buyResult = await runner.run(createInput({ side: "BUY", requestedNotional: "100" }));
    const sellResult = await runner.run(createInput({ side: "SELL", requestedNotional: "100" }));

    expect(buyResult.sliceResults[0]?.lotusResult.feeAdjustedResult).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ selectedPlanType: "MULTI_SPLIT", comparisonBasis: "provable_fill_ratio" })
      })
    );
    expect(
      (buyResult.sliceResults[0]?.lotusResult.feeAdjustedResult as { routingComparison?: { selectedPlan?: { allocations?: Array<{ venue: string }> } } }).routingComparison?.selectedPlan?.allocations?.[0]?.venue
    ).toBe("POLYMARKET");
    expect(
      (sellResult.sliceResults[0]?.lotusResult.feeAdjustedResult as { metadata?: { selectedPlanType?: string; comparisonBasis?: string } }).metadata?.selectedPlanType
    ).toBe("SINGLE_WINNER");
    expect(
      (sellResult.sliceResults[0]?.lotusResult.feeAdjustedResult as { routingComparison?: { selectedPlan?: { allocations?: Array<{ venue: string }> } } }).routingComparison?.selectedPlan?.allocations?.[0]?.venue
    ).toBe("POLYMARKET");
  });

  it("marks single-winner price-only venues as unknown-depth instead of provably full", async () => {
    const pool = createMockPool([
      createState({
        id: "price-only-limitless",
        venue: "LIMITLESS",
        venueMarketId: "price-only-market",
        lastPrice: "0.47"
      }),
      createState({
        id: "price-only-poly",
        venue: "POLYMARKET",
        venueMarketId: "price-only-poly",
        lastPrice: "0.50",
        bestBid: null,
        bestAsk: null,
        orderbookSnapshot: null
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({ requestedNotional: "100" }));
    const selectedPlan = (result.sliceResults[0]?.lotusResult.feeAdjustedResult as { routingComparison?: { selectedPlan?: Record<string, unknown> } })
      .routingComparison?.selectedPlan as Record<string, unknown>;

    expect(selectedPlan.planType).toBe("SINGLE_WINNER");
    expect(selectedPlan.containsUnknownDepth).toBe(true);
    expect(selectedPlan.provableFillRatio).toBe("0");
    expect(selectedPlan.unprovenResidualNotional).toBe("100");
    expect(Array.isArray(selectedPlan.allocations)).toBe(true);
    expect((selectedPlan.allocations as Array<Record<string, unknown>>)[0]?.isProvable).toBe(false);
    expect((selectedPlan.allocations as Array<Record<string, unknown>>)[0]?.isResidualUnknownDepth).toBe(true);
  });

  it("uses split routing for larger notionals when one venue depth is insufficient", async () => {
    const pool = createMockPool([
      createState({
        id: "split-poly",
        venue: "POLYMARKET",
        venueMarketId: "split-poly-market",
        bestBid: "0.58",
        bestAsk: "0.60",
        orderbookSnapshot: { bids: [{ price: "0.58", size: "20" }], asks: [{ price: "0.60", size: "20" }] }
      }),
      createState({
        id: "split-limitless",
        venue: "LIMITLESS",
        venueMarketId: "split-limitless-market",
        bestBid: "0.57",
        bestAsk: "0.61",
        lastPrice: "0.59"
      }),
      createState({
        id: "split-opinion",
        venue: "OPINION",
        venueMarketId: "split-opinion-market",
        bestBid: "0.575",
        bestAsk: "0.605",
        orderbookSnapshot: { bids: [{ price: "0.575", size: "200" }], asks: [{ price: "0.605", size: "200" }] }
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({
      routeMode: "POLYMARKET_LIMITLESS_OPINION",
      requestedNotional: "1000"
    }));

    const routingComparison = (result.sliceResults[0]?.lotusResult.feeAdjustedResult as { routingComparison?: { selectedPlan?: Record<string, unknown>; alternatePlan?: Record<string, unknown>; comparisonBasis?: string } }).routingComparison;
    expect(routingComparison?.selectedPlan?.planType).toBe("MULTI_SPLIT");
    expect(routingComparison?.comparisonBasis).toBe("provable_fill_ratio");
    expect(routingComparison?.selectedPlan?.allocations).toHaveLength(3);
    expect((routingComparison?.selectedPlan?.allocations as Array<Record<string, unknown>>)[2]?.depthSource).toBe("unknown_depth_residual");
    expect((routingComparison?.selectedPlan?.allocations as Array<Record<string, unknown>>)[2]?.isResidualUnknownDepth).toBe(true);
    expect(routingComparison?.selectedPlan?.containsUnknownDepth).toBe(true);
    expect(routingComparison?.selectedPlan?.provableFilledQuantity).not.toBe(routingComparison?.selectedPlan?.filledQuantity);
  });

  it("compares plans on provable fill before unknown residual economics", async () => {
    const pool = createMockPool([
      createState({
        id: "provable-poly",
        venue: "POLYMARKET",
        venueMarketId: "provable-poly",
        bestBid: "0.50",
        bestAsk: "0.52",
        orderbookSnapshot: { bids: [{ price: "0.50", size: "120" }], asks: [{ price: "0.52", size: "120" }] }
      }),
      createState({
        id: "price-only-limitless",
        venue: "LIMITLESS",
        venueMarketId: "price-only-limitless",
        lastPrice: "0.49"
      }),
      createState({
        id: "price-only-opinion",
        venue: "OPINION",
        venueMarketId: "price-only-opinion",
        lastPrice: "0.495"
      })
    ]);
    const runner = createRunner(pool);

    const result = await runner.run(createInput({
      routeMode: "POLYMARKET_LIMITLESS_OPINION",
      requestedNotional: "100"
    }));
    const comparison = (result.sliceResults[0]?.lotusResult.feeAdjustedResult as { routingComparison?: Record<string, unknown> }).routingComparison as Record<string, unknown>;

    expect(comparison.comparisonBasis).toBe("provable_fill_ratio");
    expect((comparison.selectedPlan as Record<string, unknown>).planType).toBe("MULTI_SPLIT");
    expect((comparison.alternatePlan as Record<string, unknown>).containsUnknownDepth).toBe(true);
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
          opinionOnlyBaselineEvaluator: new OpinionOnlyBaselineEvaluator(),
          myriadOnlyBaselineEvaluator: new MyriadOnlyBaselineEvaluator(),
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
