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
          totalLiquidityUsd: null,
          total_liquidity_usd: null,
          volume24hUsd: null,
          volume_24h_usd: null,
          volumeTotalUsd: null,
          volume_total_usd: null,
          openInterest: null,
          open_interest: null,
          feeRateBps: "0",
          fee_rate_bps: null
        })),
        getMarketLastSale: vi.fn(async () => ({
          price: "0.45",
          priceInCurrency: null,
          price_in_currency: null,
          size: "25",
          timestamp: "2026-03-27T10:00:00.000Z"
        }))
      }
    });

    const markets = await adapter.listMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.statistics?.volume).toBe("1000");

    const seed = adapter.buildCanonicalSeed({ market: markets[0]! });
    expect(seed.venue).toBe("PREDICT");
    expect(seed.marketClass).toBe("BINARY");
    expect(seed.canonicalCategory).toBe("CRYPTO");
    expect(seed.normalizedPayload).toMatchObject({
      environment: "testnet",
      marketId: "m-1"
    });
  });

  it("infers sports and esports buckets from current-state Predict text", () => {
    const adapter = new PredictMarketAdapter({
      environment: "mainnet",
      metadataVersion: "predict-v1",
      client: {
        getMarkets: vi.fn(),
        getMarketById: vi.fn(),
        getMarketStatistics: vi.fn(),
        getMarketLastSale: vi.fn()
      }
    });

    expect(adapter.inferCanonicalCategory({
      venue: "PREDICT",
      environment: "mainnet",
      venueMarketId: "sports-1",
      title: "Will Crystal Palace FC win on 2025-12-14?",
      description: "Premier League match market",
      question: null,
      status: "OPEN",
      categories: ["match-epl-cry-mac-2025-12-14"],
      tags: ["SPORTS_MATCH"],
      chainId: null,
      contractAddress: null,
      tokenId: null,
      outcomes: [],
      statistics: null,
      lastSale: null,
      createdAt: null,
      closesAt: null,
      resolvesAt: null,
      ambiguousTimeBoundary: false,
      sourceMetadataVersion: "predict-v1",
      raw: {}
    })).toBe("SPORTS");

    expect(adapter.inferCanonicalCategory({
      venue: "PREDICT",
      environment: "mainnet",
      venueMarketId: "esports-1",
      title: "Will T1 win the LCK 2026 season playoffs?",
      description: "League of Legends playoff market",
      question: null,
      status: "OPEN",
      categories: ["lck-2026"],
      tags: [],
      chainId: null,
      contractAddress: null,
      tokenId: null,
      outcomes: [],
      statistics: null,
      lastSale: null,
      createdAt: null,
      closesAt: null,
      resolvesAt: null,
      ambiguousTimeBoundary: false,
      sourceMetadataVersion: "predict-v1",
      raw: {}
    })).toBe("ESPORTS");
  });
});
