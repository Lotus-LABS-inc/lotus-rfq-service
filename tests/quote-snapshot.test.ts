import { describe, expect, it } from "vitest";
import {
  calculateVenueQuote,
  CompositeVenueQuoteSource,
  EnvVenueQuoteMappingResolver,
  QuoteSnapshotCache,
  type NormalizedVenueQuoteSnapshot
} from "../src/core/sor/quote-snapshot.js";
import { LimitlessQuoteReader } from "../src/integrations/limitless/limitless-quote-reader.js";
import { parseProfileFeeBps } from "../src/integrations/limitless/limitless-fee-reader.js";
import { PolymarketQuoteReader } from "../src/integrations/polymarket/polymarket-quote-reader.js";

const now = new Date("2026-05-05T20:00:00.000Z");

const snapshot = (overrides: Partial<NormalizedVenueQuoteSnapshot> = {}): NormalizedVenueQuoteSnapshot => ({
  venue: "POLYMARKET",
  venueMarketId: "market-1",
  venueOutcomeId: "yes",
  source: "REST",
  quoteQuality: "FULL_DEPTH_REST",
  sourceTimestamp: now,
  receivedAt: now,
  bids: [
    { price: "0.49", size: "100" },
    { price: "0.48", size: "100" }
  ],
  asks: [
    { price: "0.51", size: "100" },
    { price: "0.52", size: "100" }
  ],
  feeBps: 4,
  settlementEvidenceSupported: true,
  blockers: [],
  missingFactors: [],
  streamResynced: true,
  ...overrides
});

describe("quote snapshot calculator", () => {
  it("derives buy weighted price, spread, slippage, and liquidity from full depth", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot(),
      side: "buy",
      amount: 150,
      now
    });

    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(0.513333333333, 10);
    expect(result.availableSize).toBe(200);
    expect(result.spreadBps).toBeCloseTo(400);
    expect(result.slippageBps).toBeGreaterThan(0);
    expect(result.liquidityScore).toBeGreaterThan(0);
  });

  it("derives sell weighted price by walking bids", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot(),
      side: "sell",
      amount: 150,
      now
    });

    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(0.486666666667, 10);
  });

  it("blocks stale snapshots", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot({ receivedAt: new Date(now.getTime() - 2_000), source: "STREAM", quoteQuality: "FULL_DEPTH_STREAM" }),
      side: "buy",
      amount: 10,
      now
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("QUOTE_SNAPSHOT_STALE");
  });

  it("blocks insufficient depth for requested size", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot(),
      side: "buy",
      amount: 250,
      now
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("NO_DEPTH_FOR_SIZE");
  });

  it("adds confidence penalty for top-of-book and missing fee discovery", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot({
        quoteQuality: "TOP_OF_BOOK_REST",
        feeBps: undefined,
        staticFeeApproved: false,
        asks: [{ price: "0.51", size: "100" }],
        bids: [{ price: "0.49", size: "100" }]
      }),
      side: "buy",
      amount: 10,
      now
    });

    expect(result.ok).toBe(true);
    expect(result.missingFactors).toContain("FEE_DISCOVERY");
    expect(result.confidencePenaltyBps).toBeGreaterThanOrEqual(10);
  });
});

describe("venue quote readers", () => {
  it("prefers fresh Polymarket stream snapshot over REST", async () => {
    const cache = new QuoteSnapshotCache();
    cache.put(snapshot({ source: "STREAM", quoteQuality: "FULL_DEPTH_STREAM" }));
    let restCalls = 0;
    const reader = new PolymarketQuoteReader({
      streamCache: cache,
      client: {
        async getOrderbook() {
          restCalls += 1;
          return { bids: [], asks: [] };
        }
      },
      now: () => now
    });

    const result = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "market-1",
      venueOutcomeId: "yes",
      side: "buy",
      quantity: 1
    });

    expect(result?.source).toBe("STREAM");
    expect(restCalls).toBe(0);
  });

  it("falls back to Limitless REST when no stream snapshot is cached", async () => {
    const reader = new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: {
        async getOrderbook() {
          return {
            data: {
              bids: [{ price: "0.49", size: "10" }],
              asks: [{ price: "0.51", size: "10" }]
            }
          };
        }
      },
      now: () => now,
      feeBps: 3
    });

    const result = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "limitless-market-1",
      side: "buy",
      quantity: 1
    });

    expect(result?.source).toBe("REST");
    expect(result?.feeBps).toBe(3);
    expect(result?.asks[0]?.price).toBe("0.51");
  });

  it("uses the Limitless fee reader when static quote fee is absent", async () => {
    let feeCalls = 0;
    const reader = new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: {
        async getOrderbook() {
          return {
            bids: [{ price: "0.49", size: "10" }],
            asks: [{ price: "0.51", size: "10" }]
          };
        }
      },
      feeReader: {
        async getFeeBps() {
          feeCalls += 1;
          return 125;
        }
      },
      now: () => now
    });

    const result = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "limitless-market-1",
      side: "buy",
      quantity: 1
    });

    expect(result?.feeBps).toBe(125);
    expect(result?.missingFactors).toEqual([]);
    expect(feeCalls).toBe(1);
  });

  it("parses Limitless profile rank fee bps", () => {
    expect(parseProfileFeeBps({ rank: { feeRateBps: 300 } })).toBe(300);
    expect(parseProfileFeeBps({ feeRateBps: "125" })).toBe(125);
    expect(parseProfileFeeBps({ rank: {} })).toBeNull();
  });

  it("returns calculated snapshots for mapped Polymarket and Limitless venues", async () => {
    const source = new CompositeVenueQuoteSource([
      {
        venue: "POLYMARKET",
        async getQuoteSnapshot() {
          return snapshot({ venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" });
        }
      },
      {
        venue: "LIMITLESS",
        async getQuoteSnapshot() {
          return snapshot({ venue: "LIMITLESS", venueMarketId: "lim-1", venueOutcomeId: "yes" });
        }
      }
    ], new EnvVenueQuoteMappingResolver(JSON.stringify({
      "canonical-1|yes": [
        { venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" },
        { venue: "LIMITLESS", venueMarketId: "lim-1", venueOutcomeId: "yes" }
      ]
    })), () => now);

    const results = await source.getCalculatedSnapshots({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "yes",
      side: "buy",
      quantity: 1
    });

    expect(results.map((result) => result.venue)).toEqual(["POLYMARKET", "LIMITLESS"]);
    expect(results.every((result) => result.metadata.quoteQuality === "FULL_DEPTH_REST")).toBe(true);
  });
});
