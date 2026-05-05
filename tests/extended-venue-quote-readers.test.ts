import { describe, expect, it } from "vitest";
import { calculateVenueQuote, QuoteSnapshotCache } from "../src/core/sor/quote-snapshot.js";
import { normalizeMyriadQuote } from "../src/integrations/myriad/myriad-quote-reader.js";
import { normalizeOpinionOrderbook, OpinionQuoteReader, parseOpinionTopicRate } from "../src/integrations/opinion/opinion-quote-reader.js";
import { normalizePredictOrderbook, PredictQuoteReader } from "../src/integrations/predict/predict-quote-reader.js";

const now = new Date("2026-05-05T22:30:00.000Z");

describe("extended venue quote readers", () => {
  it("normalizes Predict orderbooks with market-stat fee bps", () => {
    const snapshot = normalizePredictOrderbook({
      payload: {
        bids: [{ price: "0.40", size: "10" }],
        asks: [{ price: "0.42", size: "10" }],
        timestamp: now.toISOString()
      },
      venueMarketId: "predict-market-1",
      receivedAt: now,
      environment: "mainnet",
      venueFeeBps: 25
    });

    const calculated = calculateVenueQuote({ snapshot, side: "buy", amount: 1, now });

    expect(calculated.ok).toBe(true);
    expect(calculated.feeQuote?.feeModel).toBe("PREDICT_MARKET_STATS");
    expect(calculated.effectiveFeeBps).toBe(25);
    expect(calculated.missingFactors).not.toContain("FEE_DISCOVERY");
  });

  it("Predict reader fetches stats alongside orderbook", async () => {
    const reader = new PredictQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      environment: "mainnet",
      now: () => now,
      client: {
        async getMarketOrderbook() {
          return { bids: [{ price: "0.4", size: "10" }], asks: [{ price: "0.42", size: "10" }] };
        },
        async getMarketStatistics() {
          return { feeRateBps: "35" };
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "predict-market-1",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.venueFeeBps).toBe(35);
    expect(snapshot?.venueFeeModel).toBe("PREDICT_MARKET_STATS");
  });

  it("normalizes Opinion orderbooks with documented topic-rate fee curve", () => {
    const snapshot = normalizeOpinionOrderbook({
      payload: {
        result: {
          timestamp: now.getTime(),
          bids: [{ price: "0.49", size: "10" }],
          asks: [{ price: "0.51", size: "10" }]
        }
      },
      venueMarketId: "opinion-market-1",
      venueOutcomeId: "token-yes",
      receivedAt: now,
      topicRate: 0.04
    });

    const calculated = calculateVenueQuote({ snapshot, side: "buy", amount: 10, now });

    expect(calculated.ok).toBe(true);
    expect(calculated.feeQuote?.feeModel).toBe("OPINION_TAKER_CURVE");
    expect(calculated.missingFactors).not.toContain("FEE_DISCOVERY");
  });

  it("parses Opinion topic rate from nested API payload variants", () => {
    expect(parseOpinionTopicRate({ result: { market: { topic_rate: "0.04" } } })).toBe(0.04);
    expect(parseOpinionTopicRate({ data: { feeConfig: { topicRate: 0.03 } } })).toBe(0.03);
    expect(parseOpinionTopicRate({ result: { orderbook: { bids: [] } } })).toBeNull();
  });

  it("Opinion reader uses API topic rate when config fallback is absent", async () => {
    const reader = new OpinionQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getTokenOrderbook() {
          return {
            result: {
              feeConfig: { topic_rate: "0.04" },
              bids: [{ price: "0.49", size: "10" }],
              asks: [{ price: "0.51", size: "10" }]
            }
          };
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "opinion-market-1",
      venueOutcomeId: "token-yes",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.opinionTopicRate).toBe(0.04);
    expect(snapshot?.missingFactors).toEqual([]);
  });

  it("normalizes Myriad quote responses as indicative executable depth with exact fee", () => {
    const snapshot = normalizeMyriadQuote({
      payload: {
        price_average: 0.32,
        price_before: 0.31,
        price_after: 0.33,
        shares: 10,
        fees: { treasury: 0.02, distributor: 0.01, fee: 0.04 }
      },
      venueMarketId: "myriad-market-1",
      venueOutcomeId: "0",
      side: "buy",
      quantity: 10,
      receivedAt: now
    });

    const calculated = calculateVenueQuote({ snapshot, side: "buy", amount: 10, now });

    expect(calculated.ok).toBe(true);
    expect(calculated.quoteQuality).toBe("INDICATIVE_DEPTH");
    expect(calculated.feeQuote?.feeModel).toBe("MYRIAD_QUOTE_API");
    expect(calculated.feeAmount).toBeCloseTo(0.07);
  });
});
