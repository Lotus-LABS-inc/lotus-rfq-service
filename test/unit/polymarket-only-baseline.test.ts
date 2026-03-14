import { describe, expect, it } from "vitest";

import { HistoricalMarketClass, type HistoricalMarketState } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { PolymarketOnlyBaselineEvaluator } from "../../src/simulation/baselines/polymarket-only-baseline.js";
import { HistoricalSimulationBaselineError } from "../../src/simulation/baselines/shared.js";

const feePolicy = {
  version: "fees-v1",
  venues: {
    POLYMARKET: { feeBps: "10" },
    LIMITLESS: { feeBps: "20" }
  }
} as const;

const createState = (overrides: Partial<HistoricalMarketState>): HistoricalMarketState => ({
  id: "state-1",
  canonicalEventId: "canonical-sports-1",
  canonicalCategory: "SPORTS",
  venue: "POLYMARKET",
  venueMarketId: "condition-1",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  midpoint: "0.55",
  bestBid: "0.54",
  bestAsk: "0.56",
  spread: "0.02",
  lastPrice: "0.57",
  volume: null,
  openInterest: null,
  candles: null,
  orderbookSnapshot: { bids: [{ price: "0.54", size: "3" }], asks: [{ price: "0.56", size: "3" }] },
  marketEvents: null,
  trades: null,
  ownExecutionHistory: null,
  metadataVersion: "predexon-v2",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
});

describe("PolymarketOnlyBaselineEvaluator", () => {
  it("produces deterministic output for a sports binary slice", () => {
    const evaluator = new PolymarketOnlyBaselineEvaluator();
    const input = {
      canonicalEventId: "canonical-sports-1",
      marketStates: [
        createState({ id: "state-2", timestamp: new Date("2026-03-13T00:01:00.000Z"), bestAsk: "0.52", midpoint: "0.51", lastPrice: "0.53", sourceTimestamp: new Date("2026-03-13T00:01:00.000Z"), orderbookSnapshot: { bids: [{ price: "0.50", size: "2" }], asks: [{ price: "0.52", size: "2" }] } }),
        createState({})
      ],
      feePolicy
    };

    const first = evaluator.evaluate(input);
    const second = evaluator.evaluate(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.effectiveCost).toBe("0.52052");
    expect(first.slippage).toBe("-0.04");
    expect(first.fees).toBe("0.00052");
    expect(first.fillProbability).toBe("1");
  });

  it("fails closed on mixed canonical events", () => {
    const evaluator = new PolymarketOnlyBaselineEvaluator();

    expect(() =>
      evaluator.evaluate({
        canonicalEventId: "canonical-sports-1",
        marketStates: [
          createState({ canonicalEventId: "canonical-sports-1" }),
          createState({ id: "state-2", canonicalEventId: "canonical-sports-2" })
        ],
        feePolicy
      })
    ).toThrow(HistoricalSimulationBaselineError);
  });
});
