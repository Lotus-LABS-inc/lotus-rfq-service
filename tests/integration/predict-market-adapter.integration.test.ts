import { describe, expect, it, vi } from "vitest";

import { PredictMarketAdapter } from "../../src/integrations/predict/predict-market-adapter.js";

describe("PredictMarketAdapter integration", () => {
  it("normalizes discovery payloads and builds canonical seeds", async () => {
    const adapter = new PredictMarketAdapter({
      environment: "testnet",
      metadataVersion: "predict-v1",
      client: {
        getMarkets: vi.fn(async () => [
          {
            id: "m-1",
            title: "Will BTC close above $100k?",
            description: "Binary market",
            category: "CRYPTO",
            tags: ["btc"],
            outcomes: [
              { id: "yes", label: "Yes", tokenId: "t-yes" },
              { id: "no", label: "No", tokenId: "t-no" }
            ]
          }
        ]),
        getMarketById: vi.fn(),
        getMarketStatistics: vi.fn(async () => ({
          volume: "1000",
          liquidity: null,
          openInterest: null,
          open_interest: null,
          feeRateBps: "0",
          fee_rate_bps: null
        })),
        getMarketLastSale: vi.fn(async () => ({ price: "0.45", size: "25", timestamp: "2026-03-27T10:00:00.000Z" }))
      }
    });

    const markets = await adapter.listMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.statistics?.volume).toBe("1000");

    const seed = adapter.buildCanonicalSeed({ market: markets[0]! });
    expect(seed.venue).toBe("PREDICT");
    expect(seed.marketClass).toBe("BINARY");
    expect(seed.normalizedPayload).toMatchObject({
      environment: "testnet",
      marketId: "m-1"
    });
  });
});
