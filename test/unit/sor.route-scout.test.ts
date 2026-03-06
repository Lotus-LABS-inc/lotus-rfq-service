import { describe, expect, it, vi } from "vitest";
import { RouteScout } from "../../src/core/sor/route-scout.js";

describe("SOR RouteScout", () => {
  it("normalizes LP + canonical + internal results into RouteCandidate[] shape", async () => {
    const redisSet = vi.fn(async () => "OK" as const);
    const scout = new RouteScout({
      redis: {
        get: async () => null,
        set: redisSet
      },
      lpSource: {
        getWholeComboQuotes: async () => [
          {
            quoteId: "combo-quote-1",
            providerId: "lp-combo-1",
            availableSize: 100,
            quotedPrice: 1.01,
            fees: { taker_fee: 0.001 },
            latencyMs: 12,
            fillProb: 0.91
          }
        ],
        getPerLegQuotes: async (_rfq, legId) => [
          {
            quoteId: `leg-quote-${legId}`,
            providerId: "lp-leg-1",
            legId,
            availableSize: 40,
            quotedPrice: 1.02,
            fees: { taker_fee: 0.002 },
            latencyMs: 15,
            fillProb: 0.83
          }
        ]
      },
      canonicalClient: {
        getOrderbookSnapshot: async () => ({
          snapshotId: "snapshot-1",
          availableSize: 60,
          quotedPrice: 1.015,
          fees: { venue_fee: 0.0005 },
          latencyMs: 8,
          fillProb: 0.88
        })
      },
      internalCrossingSource: {
        getCrossingHints: async () => [
          {
            hintId: "cross-1",
            providerId: "internal-book",
            availableSize: 20,
            quotedPrice: 1.0,
            fees: {},
            latencyMs: 1,
            fillProb: 0.95
          }
        ]
      },
      cacheTtlMs: 600
    });

    const candidates = await scout.discoverCandidates(
      {
        rfqId: "743463b6-d96e-4f57-a9cb-0df01f0b2837",
        idempotencyKey: "idem-743463b6-d96e-4f57-a9cb-0df01f0b2837",
        stpMode: "CANCEL_NEWEST",
        canonicalMarketId: "market-1",
        takerId: "fddf7aa6-11ce-4039-836f-6f7e5ca77011",
        side: "buy",
        quantity: "5",
        metadata: {
          legs: [
            {
              leg_id: "5f0812cf-b67c-40f0-a26c-992f66196935",
              canonical_market_id: "market-1",
              side: "buy",
              quantity: 5
            }
          ]
        }
      },
      {
        quoteId: "selected-quote-1",
        price: 1.01,
        quantity: 5,
        feeBps: 0
      },
      "ALL_OR_NONE"
    );

    expect(candidates.length).toBe(4);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        leg_id: expect.any(String),
        provider_type: expect.any(String),
        provider_id: expect.any(String),
        available_size: expect.any(Number),
        quoted_price: expect.any(Number),
        fees: expect.any(Object),
        latency_ms: expect.any(Number),
        fill_prob: expect.any(Number)
      })
    );
    expect(redisSet).toHaveBeenCalledWith(
      "sor:candidates:743463b6-d96e-4f57-a9cb-0df01f0b2837:selected-quote-1:ALL_OR_NONE",
      expect.any(String),
      "PX",
      600
    );
  });

  it("returns cached candidates when available and skips upstream sources unless forceRefresh=true", async () => {
    const cachedPayload = JSON.stringify([
      {
        id: "ab8f58f7-9c01-4ff9-a4cc-0e95cfad1c75",
        leg_id: "5f0812cf-b67c-40f0-a26c-992f66196935",
        provider_type: "LP",
        provider_id: "lp-cached",
        available_size: 10,
        quoted_price: 1.03,
        fees: { taker_fee: 0.001 },
        latency_ms: 11,
        fill_prob: 0.82
      }
    ]);
    const getMock = vi.fn(async () => cachedPayload);
    const setMock = vi.fn(async () => "OK" as const);
    const wholeComboMock = vi.fn(async () => []);

    const scout = new RouteScout({
      redis: {
        get: getMock,
        set: setMock
      },
      lpSource: {
        getWholeComboQuotes: wholeComboMock,
        getPerLegQuotes: async () => []
      },
      canonicalClient: {
        getOrderbookSnapshot: async () => null
      },
      cacheTtlMs: 50
    });

    const rfq = {
      rfqId: "743463b6-d96e-4f57-a9cb-0df01f0b2837",
      idempotencyKey: "idem-743463b6-d96e-4f57-a9cb-0df01f0b2837",
      stpMode: "CANCEL_NEWEST" as const,
      canonicalMarketId: "market-1",
      takerId: "fddf7aa6-11ce-4039-836f-6f7e5ca77011",
      side: "buy" as const,
      quantity: "5"
    };
    const selectedQuote = {
      quoteId: "selected-quote-1",
      price: 1.01,
      quantity: 5,
      feeBps: 0
    };

    const fromCache = await scout.discoverCandidates(rfq, selectedQuote, "ALL_OR_NONE");
    expect(fromCache).toHaveLength(1);
    expect(wholeComboMock).not.toHaveBeenCalled();

    getMock.mockResolvedValueOnce(cachedPayload);
    await scout.discoverCandidates(rfq, selectedQuote, "ALL_OR_NONE", { forceRefresh: true });
    expect(wholeComboMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith(
      "sor:candidates:743463b6-d96e-4f57-a9cb-0df01f0b2837:selected-quote-1:ALL_OR_NONE",
      expect.any(String),
      "PX",
      250
    );
  });
});
