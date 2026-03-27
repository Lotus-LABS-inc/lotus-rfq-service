import { describe, expect, it, vi } from "vitest";

import { PredictOrderbookAdapter } from "../../src/integrations/predict/predict-orderbook-adapter.js";

describe("PredictOrderbookAdapter integration", () => {
  it("normalizes orderbook snapshots deterministically", async () => {
    const adapter = new PredictOrderbookAdapter({
      environment: "mainnet",
      client: {
        getMarketOrderbook: vi.fn(async () => ({
          marketId: "m-1",
          market_id: undefined,
          timestamp: "2026-03-27T10:00:00.000Z",
          bids: [{ price: "0.42", size: "100", raw: {} }],
          asks: [{ price: "0.44", size: "120", raw: {} }]
        }))
      }
    });

    const snapshot = await adapter.getOrderbookSnapshot("m-1");
    expect(snapshot.bestBid).toBe("0.42");
    expect(snapshot.bestAsk).toBe("0.44");
    expect(snapshot.spread).toBe("0.02");
    expect(snapshot.topOfBookSize).toBe("220");
  });
});
