import { describe, expect, it } from "vitest";
import {
  calculateEffectiveCost,
  rankQuotesByEffectiveCost,
  type NormalizedQuote
} from "../src/core/ranking/quote-ranking.js";

describe("quote ranking", () => {
  it("calculates effective cost using all fee and impact components", () => {
    const quote: NormalizedQuote = {
      quoteId: "q1",
      basePrice: 100,
      venueFee: 1.2,
      protocolFee: 0.5,
      gasCost: 0.75,
      slippageEstimate: 1.05,
      reliabilityScore: 90,
      latencyScore: 80
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
        latencyScore: 99
      },
      {
        quoteId: "q-cheap",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 0.5,
        gasCost: 0.5,
        slippageEstimate: 1,
        reliabilityScore: 50,
        latencyScore: 50
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
        latencyScore: 99
      },
      {
        quoteId: "q-rel-high-lat-low",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 90,
        latencyScore: 40
      },
      {
        quoteId: "q-rel-high-lat-high",
        basePrice: 100,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 90,
        latencyScore: 95
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
        latencyScore: 1
      },
      {
        quoteId: "a",
        basePrice: 1,
        venueFee: 1,
        protocolFee: 1,
        gasCost: 1,
        slippageEstimate: 1,
        reliabilityScore: 1,
        latencyScore: 1
      }
    ];

    const originalOrder = quotes.map((quote) => quote.quoteId);
    void rankQuotesByEffectiveCost(quotes);

    expect(quotes.map((quote) => quote.quoteId)).toEqual(originalOrder);
  });
});

