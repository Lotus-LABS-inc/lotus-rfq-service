import { describe, expect, it } from "vitest";

import { PredictSizeEstimator } from "../../src/simulation/predict/predict-size-estimator.js";
import { buildPredictSimulationSurface } from "../../src/simulation/predict/predict-simulation-surface.js";

describe("Predict determinism integration", () => {
  it("produces the same estimate for the same simulation evidence", () => {
    const surface = buildPredictSimulationSurface({
      market: null,
      currentOrderbook: {
        venue: "PREDICT",
        environment: "testnet",
        marketId: "m-1",
        sourceTimestamp: new Date("2026-03-27T10:00:00.000Z"),
        bids: [{ price: "0.40", size: "10", raw: {} }],
        asks: [{ price: "0.42", size: "10", raw: {} }],
        bestBid: "0.40",
        bestAsk: "0.42",
        spread: "0.02",
        midpoint: "0.41",
        topOfBookSize: "20",
        raw: {}
      }
    });
    const estimator = new PredictSizeEstimator();

    const left = estimator.estimate({ surface, requestedSize: "2", side: "BUY" });
    const right = estimator.estimate({ surface, requestedSize: "2", side: "BUY" });

    expect(right).toEqual(left);
  });
});
