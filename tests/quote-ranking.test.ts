import { describe, expect, it } from "vitest";
import {
  calculateEffectiveCost,
  rankQuotesByEffectiveCost,
  type NormalizedQuote
} from "../src/core/ranking/quote-ranking.js";

describe("quote ranking", () => {
  const liveWindow = {
    expires_at: "2099-12-31T23:59:59.000Z",
    firm_until: "2099-12-31T23:00:00.000Z",
    soft_refresh_flag: false
  } as const;

  it("calculates effective cost using all fee and impact components", () => {
    const quote: NormalizedQuote = {
      quoteId: "q1",
      basePrice: 100,
      venueFee: 1.2,
      protocolFee: 0.5,
      gasCost: 0.75,
      slippageEstimate: 1.05,
      reliabilityScore: 90,
      latencyScore: 80,
      ...liveWindow
    };

    expect(calculateEffectiveCost(quote)).toBe(103.5);
  });

  it("ranks quotes by lowest effective cost first", () => {
    const ranked = rankQuotesByEffectiveCost([
      {
        quoteId: "q-expensive",
        basePrice: 105,
        venueFee: 1,
        protocolFee: 0.5,
        gasCost: 0.5,
        slippageEstimate: 1,
        reliabilityScore: 99,
        latencyScore: 99,
        ...liveWindow
      },
      {
        quoteId: "q-cheap",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 0.5,
        gasCost: 0.5,
        slippageEstimate: 1,
        reliabilityScore: 50,
        latencyScore: 50,
        ...liveWindow
      }
    ]);

    expect(ranked.map((quote) => quote.quoteId)).toEqual(["q-cheap", "q-expensive"]);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);
  });

  it("applies tie-break by reliability score then latency score", () => {
    const quotes: NormalizedQuote[] = [
      {
        quoteId: "q-rel-low",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 70,
        latencyScore: 99,
        ...liveWindow
      },
      {
        quoteId: "q-rel-high-lat-low",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 90,
        latencyScore: 40,
        ...liveWindow
      },
      {
        quoteId: "q-rel-high-lat-high",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 90,
        latencyScore: 95,
        ...liveWindow
      }
    ];

    const ranked = rankQuotesByEffectiveCost(quotes);
    expect(ranked.map((quote) => quote.quoteId)).toEqual([
      "q-rel-high-lat-high",
      "q-rel-high-lat-low",
      "q-rel-low"
    ]);
  });

  it("is pure and does not mutate input array order", () => {
    const quotes: NormalizedQuote[] = [
      {
        quoteId: "b",
        basePrice: 1,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 1,
        latencyScore: 1,
        ...liveWindow
      },
      {
        quoteId: "a",
        basePrice: 1,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 1,
        latencyScore: 1,
        ...liveWindow
      }
    ];

    const originalOrder = quotes.map((quote) => quote.quoteId);
    void rankQuotesByEffectiveCost(quotes);

    expect(quotes.map((quote) => quote.quoteId)).toEqual(originalOrder);
  });

  it("excludes expired and non-firm quotes from ranking", () => {
    const ranked = rankQuotesByEffectiveCost([
      {
        quoteId: "q-expired",
        basePrice: 1,
        venueFee: 0,
        protocolFee: 0,
        gasCost: 0,
        slippageEstimate: 0,
        reliabilityScore: 100,
        latencyScore: 100,
        expires_at: "2020-01-01T00:00:00.000Z",
        firm_until: "2020-01-01T00:00:00.000Z",
        soft_refresh_flag: false
      },
      {
        quoteId: "q-valid",
        basePrice: 2,
        venueFee: 0,
        protocolFee: 0,
        gasCost: 0,
        slippageEstimate: 0,
        reliabilityScore: 100,
        latencyScore: 100,
        ...liveWindow
      }
    ]);

    expect(ranked.map((quote) => quote.quoteId)).toEqual(["q-valid"]);
  });

  it("applies reliability scoring impact while keeping lower price dominant", () => {
    const ranked = rankQuotesByEffectiveCost(
      [
        {
          quoteId: "price-best",
          lpId: "lp-best-price",
          basePrice: 100,
          venueFee: 0,
          protocolFee: 0,
          gasCost: 0,
          slippageEstimate: 0,
          reliabilityScore: 10,
          latencyScore: 10,
          ...liveWindow
        },
        {
          quoteId: "price-high-reliable",
          lpId: "lp-reliable",
          basePrice: 108,
          venueFee: 0,
          protocolFee: 0,
          gasCost: 0,
          slippageEstimate: 0,
          reliabilityScore: 100,
          latencyScore: 100,
          ...liveWindow
        }
      ],
      {
        reliabilityProfiles: {
          "lp-best-price": {
            lpId: "lp-best-price",
            avgResponseTimeMs: 3000,
            quoteHitRate: 0.2,
            rejectRate: 0.2,
            executionFailRate: 0.2,
            competitivenessScore: 0.2,
            totalQuotes: 100,
            totalExecutions: 30
          },
          "lp-reliable": {
            lpId: "lp-reliable",
            avgResponseTimeMs: 30,
            quoteHitRate: 1,
            rejectRate: 0,
            executionFailRate: 0,
            competitivenessScore: 1,
            totalQuotes: 100,
            totalExecutions: 30
          }
        },
        weights: {
          reliabilityWeight: 0.02,
          latencyWeight: 0.02,
          failureWeight: 0
        }
      }
    );

    expect(ranked[0]?.quoteId).toBe("price-best");
    expect(ranked[1]?.reliabilityBonus).toBeGreaterThan(ranked[0]?.reliabilityBonus ?? 0);
  });
});
