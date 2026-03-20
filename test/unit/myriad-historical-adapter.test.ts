import { describe, expect, it, vi } from "vitest";

import { MyriadHistoricalAdapter } from "../../src/integrations/myriad/myriad-historical-adapter.js";
import type {
  MyriadClient,
  MyriadMarketDetail,
  MyriadMarketEvent,
  MyriadMarketSummary,
  MyriadQuestion
} from "../../src/integrations/myriad/myriad-schemas.js";

const marketSummary: MyriadMarketSummary = {
  id: 101,
  networkId: 137,
  slug: "btc-above-100k-by-june-30",
  title: "Will BTC be above $100k by June 30?",
  description: "Binary market.",
  state: "resolved",
  topics: ["Crypto"],
  outcomes: [
    { id: 1, title: "Yes", price: 0.61 },
    { id: 2, title: "No", price: 0.39 }
  ]
};

const marketDetail: MyriadMarketDetail = {
  ...marketSummary,
  publishedAt: "2026-03-01T00:00:00.000Z",
  expiresAt: "2026-03-30T00:00:00.000Z",
  resolvesAt: "2026-03-30T01:00:00.000Z",
  fees: { buy_lp_fee_bps: 100 },
  resolutionSource: "Myriad rules",
  resolutionTitle: "BTC above $100k by June 30",
  outcomes: [
    {
      id: 1,
      title: "Yes",
      price: 0.61,
      price_charts: [{
        timeframe: "all",
        prices: [
          { timestamp: "2026-03-10T00:00:00.000Z", price: 0.55 },
          { timestamp: "2026-03-11T00:00:00.000Z", price: 0.61 }
        ]
      }]
    },
    {
      id: 2,
      title: "No",
      price: 0.39,
      price_charts: [{
        timeframe: "all",
        prices: [
          { timestamp: "2026-03-10T00:00:00.000Z", price: 0.45 },
          { timestamp: "2026-03-11T00:00:00.000Z", price: 0.39 }
        ]
      }]
    }
  ]
};

const linkedQuestion: MyriadQuestion = {
  id: 77,
  title: "Will BTC be above $100k by June 30?",
  expiresAt: "2026-03-30T00:00:00.000Z",
  marketCount: 1,
  markets: [
    {
      id: 101,
      slug: "btc-above-100k-by-june-30",
      title: "Will BTC be above $100k by June 30?",
      description: "Binary market.",
      state: "resolved",
      networkId: 137,
      topics: ["Crypto"],
      outcomes: [
        { id: 1, title: "Yes", price: 0.61 },
        { id: 2, title: "No", price: 0.39 }
      ]
    }
  ]
};

const marketEvents: readonly MyriadMarketEvent[] = [
  {
    user: "0xabc",
    action: "buy",
    marketTitle: marketDetail.title,
    marketSlug: marketDetail.slug,
    marketId: marketDetail.id,
    networkId: marketDetail.networkId,
    outcomeTitle: "Yes",
    outcomeId: 1,
    shares: 120,
    value: 80,
    timestamp: 1_773_168_000,
    blockNumber: 1,
    token: "USDC"
  }
];

describe("MyriadHistoricalAdapter", () => {
  const buildClient = (): Pick<MyriadClient, "listMarkets" | "getMarket" | "listQuestions" | "getMarketEvents"> => ({
    listMarkets: vi.fn(async () => ({
      data: [marketSummary],
      pagination: {
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      }
    })),
    getMarket: vi.fn(async () => marketDetail),
    listQuestions: vi.fn(async () => ({
      data: [linkedQuestion],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      }
    })),
    getMarketEvents: vi.fn(async () => ({
      data: [...marketEvents],
      pagination: {
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      }
    }))
  });

  it("builds deterministic Myriad scopes and canonical graph seeds from question-linked markets", async () => {
    const adapter = new MyriadHistoricalAdapter({
      client: buildClient(),
      metadataVersion: "myriad-v1"
    });

    const scopes = await adapter.listScopedMarkets({
      categories: ["crypto"],
      batchSize: 10
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toEqual(expect.objectContaining({
      category: "crypto",
      canonicalMarketId: "MYRIAD-CRYPTO-BTC-ABOVE-100K-BY-JUNE-30-N137"
    }));

    const seed = adapter.buildCanonicalSeed(scopes[0]!);
    expect(seed.canonicalEventId).toBe(scopes[0]!.canonicalEventId);
    expect(seed.venue).toBe("MYRIAD");
    expect(seed.marketClass).toBe("BINARY");
    expect(seed.outcomes).toHaveLength(2);
  });

  it("converts price charts and events into conservative historical state fragments without inventing depth", async () => {
    const adapter = new MyriadHistoricalAdapter({
      client: buildClient(),
      metadataVersion: "myriad-v1"
    });
    const [scope] = await adapter.listScopedMarkets({
      categories: ["crypto"],
      batchSize: 10
    });

    const fragments = await adapter.buildHistoricalStateFragments({
      scope: scope!,
      windowStart: new Date("2026-03-10T00:00:00.000Z"),
      windowEnd: new Date("2026-03-11T00:00:00.000Z")
    });

    expect(fragments).toHaveLength(3);
    const chartFragment = fragments.find((fragment) => fragment.candles);
    expect(chartFragment).toEqual(expect.objectContaining({
      venue: "MYRIAD",
      lastPrice: "0.55",
      candles: expect.objectContaining({
        depthModel: "amm_conservative",
        quoteHistoryAvailable: false
      })
    }));
    expect(chartFragment).not.toHaveProperty("bestBid");
    expect(chartFragment).not.toHaveProperty("bestAsk");
    const eventFragment = fragments.find((fragment) => fragment.marketEvents);
    expect(eventFragment).toEqual(expect.objectContaining({
      venue: "MYRIAD",
      volume: "80",
      marketEvents: expect.objectContaining({
        depthModel: "amm_conservative",
        historyEvidence: "price_chart+market_events"
      })
    }));
  });
});
