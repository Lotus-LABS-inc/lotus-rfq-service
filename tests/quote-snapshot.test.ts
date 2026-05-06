import { describe, expect, it } from "vitest";
import {
  calculateVenueQuote,
  CompositeVenueQuoteSource,
  QuoteSnapshotCache,
  SharedCoreVenueQuoteMappingResolver,
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
  staticFeeApproved: true,
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
    expect(result.feeAmount).toBeCloseTo(0.0308);
    expect(result.effectiveFeeBps).toBe(4);
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
    ], {
      async resolve() {
        return [
        { venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" },
        { venue: "LIMITLESS", venueMarketId: "lim-1", venueOutcomeId: "yes" }
        ];
      }
    }, () => now);

    const results = await source.getCalculatedSnapshots({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "yes",
      side: "buy",
      quantity: 1
    });

    expect(results.map((result) => result.venue)).toEqual(["POLYMARKET", "LIMITLESS"]);
    expect(results.every((result) => result.metadata.quoteQuality === "FULL_DEPTH_REST")).toBe(true);
    expect(results.every((result) => result.fees.provider_fee !== undefined)).toBe(true);
  });

  it("keeps usable venue snapshots when another mapped reader throws", async () => {
    const source = new CompositeVenueQuoteSource([
      {
        venue: "POLYMARKET",
        async getQuoteSnapshot() {
          return snapshot({ venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" });
        }
      },
      {
        venue: "PREDICT_FUN",
        async getQuoteSnapshot() {
          throw new Error("Predict market orderbook payload validation failed.");
        }
      }
    ], {
      async resolve() {
        return [
          { venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" },
          { venue: "PREDICT_FUN", venueMarketId: "predict-1", venueOutcomeId: "yes" }
        ];
      }
    }, () => now);

    const results = await source.getCalculatedSnapshots({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "yes",
      side: "buy",
      quantity: 1
    });

    expect(results.map((result) => result.venue)).toEqual(["POLYMARKET"]);
  });

  it("reports every mapped venue as either a snapshot or blocker", async () => {
    const source = new CompositeVenueQuoteSource([
      {
        venue: "POLYMARKET",
        async getQuoteSnapshot() {
          return snapshot({ venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" });
        }
      },
      {
        venue: "PREDICT_FUN",
        async getQuoteSnapshot() {
          throw new Error("Predict market orderbook payload validation failed.");
        }
      }
    ], {
      async resolve() {
        return [];
      },
      async getReadiness() {
        return [
          {
            venue: "POLYMARKET",
            approvedVenueMarketId: "pm-approved",
            venueMarketId: "pm-1",
            venueOutcomeId: "yes",
            quoteReady: true,
            blockers: []
          },
          {
            venue: "LIMITLESS",
            approvedVenueMarketId: "limitless-approved",
            venueMarketId: "lim-1",
            venueOutcomeId: null,
            quoteReady: false,
            blockers: ["LIMITLESS_OUTCOME_ID_MISSING"]
          },
          {
            venue: "PREDICT_FUN",
            approvedVenueMarketId: "predict-approved",
            venueMarketId: "predict-1",
            venueOutcomeId: "yes",
            quoteReady: true,
            blockers: []
          }
        ];
      }
    }, () => now);

    const report = await source.getCalculatedSnapshotReport({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "yes",
      side: "buy",
      quantity: 1
    });

    expect(report.snapshots.map((result) => result.venue)).toEqual(["POLYMARKET"]);
    expect(report.blocked).toEqual([
      {
        venue: "LIMITLESS",
        reason: "LIMITLESS_OUTCOME_ID_MISSING",
        venueMarketId: "lim-1"
      },
      {
        venue: "PREDICT_FUN",
        reason: "QUOTE_READER_FAILED",
        venueMarketId: "predict-1",
        venueOutcomeId: "yes"
      }
    ]);
  });
});

describe("venue quote mapping resolvers", () => {
  it("resolves approved frontend-curated DB venue mappings back to raw venue ids", async () => {
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
            {
              venue: "LIMITLESS",
              venue_market_id: "LIMITLESS:2026-fifa-world-cup-winner-1765296582257:brazil:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
              normalized_payload: {
                curatedKey: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
                venueMarketId: "2026-fifa-world-cup-winner-1765296582257:brazil"
              },
              raw_source_payload: {}
            },
            {
              venue: "PREDICT",
              venue_market_id: "PREDICT:1522:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
              normalized_payload: {},
              raw_source_payload: { venueMarketId: "1522" }
            }
          ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    });

    const result = await resolver.resolve({ canonicalMarketId: "FRONTEND_CURATED:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL" });

    expect(result).toEqual([
      { venue: "LIMITLESS", venueMarketId: "2026-fifa-world-cup-winner-1765296582257:brazil" },
      { venue: "PREDICT", venueMarketId: "1522" }
    ]);
  });

  it("lets Polymarket resolve missing tokens at quote time while blocking unresolved Opinion slugs", async () => {
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
            {
              venue: "POLYMARKET",
              venue_market_id: "POLYMARKET:2026-fifa-world-cup-winner:brazil:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
              normalized_payload: { venueMarketId: "2026-fifa-world-cup-winner:brazil" },
              raw_source_payload: {}
            },
            {
              venue: "OPINION",
              venue_market_id: "OPINION:2026-fifa-world-cup-winner:brazil:SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026|BRAZIL",
              normalized_payload: { venueMarketId: "2026-fifa-world-cup-winner:brazil" },
              raw_source_payload: {}
            }
          ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    });

    const readiness = await resolver.getReadiness({ canonicalMarketId: "canonical-world-cup-brazil" });
    const routable = await resolver.resolve({ canonicalMarketId: "canonical-world-cup-brazil" });

    expect(routable).toEqual([{
      venue: "POLYMARKET",
      venueMarketId: "2026-fifa-world-cup-winner:brazil"
    }]);
    expect(readiness.find((row) => row.venue === "POLYMARKET")?.blockers).toEqual([]);
    expect(readiness.find((row) => row.venue === "OPINION")?.blockers).toContain("OPINION_TOKEN_ID_MISSING");
  });

  it("uses stored Polymarket quote token ids from shared-core payloads", async () => {
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:bitcoin-all-time-high-by-june-30-2026:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
            normalized_payload: {
              curatedKey: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
              venueMarketId: "bitcoin-all-time-high-by-june-30-2026",
              quoteMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
              quoteTokenId: "yes-token",
              quoteOutcomeTokenIds: {
                YES: "yes-token",
                NO: "no-token"
              }
            },
            raw_source_payload: {}
          }
        ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    });

    await expect(resolver.resolve({
      canonicalMarketId: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30"
    })).resolves.toEqual([
      {
        venue: "POLYMARKET",
        venueMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
        venueOutcomeId: "yes-token"
      }
    ]);
    await expect(resolver.resolve({
      canonicalMarketId: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
      canonicalOutcomeId: "NO"
    })).resolves.toEqual([
      {
        venue: "POLYMARKET",
        venueMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
        venueOutcomeId: "no-token"
      }
    ]);
  });
});
