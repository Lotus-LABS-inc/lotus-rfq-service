import { describe, expect, it } from "vitest";

import { HistoricalMarketClass, type HistoricalMarketState } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { BestExternalOnlyBaselineEvaluator } from "../../src/simulation/baselines/best-external-only-baseline.js";
import { NoInternalizationBaselineEvaluator } from "../../src/simulation/baselines/no-internalization-baseline.js";

const feePolicy = {
  version: "fees-v1",
  venues: {
    POLYMARKET: { feeBps: "10" },
    LIMITLESS: { feeBps: "20" }
  }
} as const;

const createState = (overrides: Partial<HistoricalMarketState>): HistoricalMarketState => ({
  id: "state",
  canonicalEventId: "canonical-event-1",
  canonicalMarketId: null,
  canonicalCategory: "OTHER",
  venue: "POLYMARKET",
  venueMarketId: "market-id",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  midpoint: null,
  bestBid: null,
  bestAsk: null,
  spread: null,
  lastPrice: "0.60",
  volume: null,
  openInterest: null,
  candles: null,
  orderbookSnapshot: null,
  marketEvents: null,
  trades: null,
  ownExecutionHistory: null,
  metadataVersion: "v1",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
});

describe("NoInternalizationBaselineEvaluator", () => {
  it("matches best-external-only economics and records stripped internalization metadata", () => {
    const bestExternal = new BestExternalOnlyBaselineEvaluator();
    const noInternalization = new NoInternalizationBaselineEvaluator(bestExternal);
    const input = {
      canonicalEventId: "canonical-event-1",
      marketStates: [
        createState({ venue: "POLYMARKET", venueMarketId: "condition-1", bestAsk: "0.55", orderbookSnapshot: { bids: [{ price: "0.54", size: "1" }], asks: [{ price: "0.55", size: "1" }] } }),
        createState({ venue: "LIMITLESS", venueMarketId: "limitless-1", lastPrice: "0.53" })
      ],
      side: "BUY",
      requestedNotional: "1",
      feePolicy
    };

    const external = bestExternal.evaluate(input);
    const stripped = noInternalization.evaluate(input);

    expect(stripped.effectiveCost).toBe(external.effectiveCost);
    expect(stripped.fees).toBe(external.fees);
    expect(stripped.slippage).toBe(external.slippage);
    expect(stripped.metadata).toMatchObject({
      internalizationStripped: true,
      sourceBaseline: "BEST_EXTERNAL_ONLY"
    });
  });
});
