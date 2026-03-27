import { describe, expect, it } from "vitest";

import { HistoricalMarketClass, type HistoricalMarketState } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { PredictOnlyBaselineEvaluator } from "../../src/simulation/baselines/predict-only-baseline.js";

describe("Predict baseline integration", () => {
  it("evaluates a Predict-only baseline from normalized historical market states", () => {
    const state: HistoricalMarketState = {
      id: "s-1",
      canonicalEventId: "event-1",
      canonicalMarketId: "market-1",
      canonicalCategory: "CRYPTO",
      venue: "PREDICT",
      venueMarketId: "predict-market-1",
      marketClass: HistoricalMarketClass.BINARY,
      timestamp: new Date("2026-03-27T10:00:00.000Z"),
      midpoint: "0.41",
      bestBid: "0.40",
      bestAsk: "0.42",
      spread: "0.02",
      lastPrice: "0.41",
      volume: "100",
      openInterest: "200",
      candles: null,
      orderbookSnapshot: {
        bids: [{ price: "0.40", size: "100" }],
        asks: [{ price: "0.42", size: "120" }]
      },
      marketEvents: null,
      trades: null,
      ownExecutionHistory: null,
      metadataVersion: "predict-v1",
      sourceTimestamp: new Date("2026-03-27T10:00:00.000Z")
    };

    const evaluator = new PredictOnlyBaselineEvaluator();
    const result = evaluator.evaluate({
      canonicalEventId: "event-1",
      marketStates: [state],
      side: "BUY",
      requestedNotional: "100",
      feePolicy: {
        version: "cfg-v1",
        venues: {
          PREDICT: { feeBps: "0" }
        }
      }
    });

    expect(result.baselineType).toBe("PREDICT_ONLY");
    expect(result.venue).toBe("PREDICT");
  });
});
