import { describe, expect, it } from "vitest";

import { buildPredictSimulationSurface } from "../../src/simulation/predict/predict-simulation-surface.js";

describe("Predict simulation surface integration", () => {
  it("classifies recorded historical precision and native provenance correctly", () => {
    const surface = buildPredictSimulationSurface({
      market: null,
      currentOrderbook: null,
      recordedOrderbooks: [{
        venue: "PREDICT",
        environment: "mainnet",
        marketId: "m-1",
        sourceTimestamp: new Date("2026-03-27T10:00:00.000Z"),
        bids: [{ price: "0.40", size: "10", raw: {} }],
        asks: [{ price: "0.42", size: "12", raw: {} }],
        bestBid: "0.40",
        bestAsk: "0.42",
        spread: "0.02",
        midpoint: "0.41",
        topOfBookSize: "22",
        raw: {}
      }],
      recordedMatchEvents: [{
        venue: "PREDICT",
        environment: "mainnet",
        kind: "MATCH",
        eventId: "e-1",
        marketId: "m-1",
        orderHash: "o-1",
        side: "BUY",
        price: "0.41",
        size: "2",
        timestamp: new Date("2026-03-27T10:00:01.000Z"),
        raw: {}
      }]
    });

    expect(surface.precision).toBe("RECORDED_HISTORICAL");
    expect(surface.provenance).toBe("NATIVE_PREDICT");
  });
});
