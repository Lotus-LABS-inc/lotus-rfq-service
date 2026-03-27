import { describe, expect, it } from "vitest";

import { PredictHistoricalFallback } from "../../src/integrations/predict/predict-historical-fallback.js";

describe("PredictHistoricalFallback integration", () => {
  it("fails closed when documented Predexon Predict fallback is unavailable", async () => {
    const fallback = new PredictHistoricalFallback({
      documentedAvailability: false
    });

    expect(fallback.getAvailability()).toMatchObject({
      documentedAvailability: false,
      available: false
    });
    await expect(
      fallback.load({
        environment: "mainnet",
        marketId: "m-1",
        start: new Date("2026-03-27T00:00:00.000Z"),
        end: new Date("2026-03-27T01:00:00.000Z")
      })
    ).resolves.toEqual([]);
  });
});
