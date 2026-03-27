import { describe, expect, it } from "vitest";

import { PredictSizeEstimator } from "../../src/simulation/predict/predict-size-estimator.js";
import { buildPredictSimulationSurface } from "../../src/simulation/predict/predict-simulation-surface.js";

describe("Predict size-aware integration", () => {
  it("returns deterministic conservative estimates by size", () => {
    const surface = buildPredictSimulationSurface({
      market: null,
      currentOrderbook: {
        venue: "PREDICT",
        environment: "mainnet",
        marketId: "m-1",
        sourceTimestamp: new Date("2026-03-27T10:00:00.000Z"),
        bids: [{ price: "0.40", size: "10", raw: {} }],
        asks: [{ price: "0.42", size: "12", raw: {} }, { price: "0.43", size: "20", raw: {} }],
        bestBid: "0.40",
        bestAsk: "0.42",
        spread: "0.02",
        midpoint: "0.41",
        topOfBookSize: "22",
        raw: {}
      }
    });
    const estimator = new PredictSizeEstimator();
    const estimate = estimator.estimate({
      surface,
      requestedSize: "5",
      side: "BUY"
    });

    expect(estimate.sizeBucket).toBe("medium");
    expect(estimate.precision).toBe("ESTIMATED_CONSERVATIVE");
    expect(estimate.estimatedEffectiveCost).not.toBeNull();
  });
});
