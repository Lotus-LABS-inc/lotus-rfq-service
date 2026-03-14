import { describe, expect, it } from "vitest";

import { HistoricalMarketClass, type HistoricalMarketState } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { LimitlessOnlyBaselineEvaluator } from "../../src/simulation/baselines/limitless-only-baseline.js";
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
  canonicalEventId: "canonical-crypto-1",
  canonicalCategory: "CRYPTO",
  venue: "LIMITLESS",
  venueMarketId: "btc-above-100k",
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: new Date("2026-03-13T00:00:00.000Z"),
  midpoint: null,
  bestBid: null,
  bestAsk: null,
  spread: null,
  lastPrice: "0.61",
  volume: null,
  openInterest: null,
  candles: { point: { price: "0.61" } },
  orderbookSnapshot: null,
  marketEvents: null,
  trades: null,
  ownExecutionHistory: null,
  metadataVersion: "limitless-v1",
  sourceTimestamp: new Date("2026-03-13T00:00:00.000Z"),
  ...overrides
});

describe("LimitlessOnlyBaselineEvaluator", () => {
  it("produces stable crypto threshold output with nullable fill probability when only price history exists", () => {
    const evaluator = new LimitlessOnlyBaselineEvaluator();
    const input = {
      canonicalEventId: "canonical-crypto-1",
      marketStates: [
        createState({ id: "state-2", timestamp: new Date("2026-03-13T00:02:00.000Z"), lastPrice: "0.58", sourceTimestamp: new Date("2026-03-13T00:02:00.000Z") }),
        createState({})
      ],
      feePolicy
    };

    const first = evaluator.evaluate(input);
    const second = evaluator.evaluate(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.effectiveCost).toBe("0.58116");
    expect(first.slippage).toBe("-0.03");
    expect(first.fees).toBe("0.00116");
    expect(first.fillProbability).toBeNull();
    expect(first.fillProbabilityReason).toBe("price_only_history");
  });

  it("fails closed when no usable price evidence exists", () => {
    const evaluator = new LimitlessOnlyBaselineEvaluator();

    expect(() =>
      evaluator.evaluate({
        canonicalEventId: "canonical-crypto-1",
        marketStates: [createState({ lastPrice: null, candles: null, ownExecutionHistory: { strategy: "Buy" } })],
        feePolicy
      })
    ).toThrow(HistoricalSimulationBaselineError);
  });
});
