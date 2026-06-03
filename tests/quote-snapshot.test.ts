import { describe, expect, it } from "vitest";
import {
  calculateVenueQuote,
  CompositeVenueQuoteSource,
  QuoteSnapshotCache,
  SharedCoreVenueQuoteMappingResolver,
  type NormalizedVenueQuoteSnapshot,
  type VenueQuoteSnapshotReader
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

  it("keeps partial-depth snapshots usable so the router can aggregate venues", () => {
    const result = calculateVenueQuote({
      snapshot: snapshot(),
      side: "buy",
      amount: 250,
      now
    });

    expect(result.ok).toBe(true);
    expect(result.availableSize).toBe(200);
    expect(result.missingFactors).toContain("PARTIAL_DEPTH_FOR_SIZE");
    expect(result.blockers).not.toContain("NO_DEPTH_FOR_SIZE");
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

  it("allows cached display reads to use recent DB-backed snapshot fallback", async () => {
    const getDisplayCalls: unknown[] = [];
    const source = new CompositeVenueQuoteSource([], {
      async resolve() {
        return [];
      },
      async getReadiness() {
        return [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "pm-approved",
          venueMarketId: "pm-1",
          venueOutcomeId: "yes",
          quoteReady: true,
          blockers: []
        }];
      }
    }, () => now, {
      touch() {},
      async get() {
        return null;
      },
      async getDisplay(input) {
        getDisplayCalls.push(input);
        return snapshot({ venue: "POLYMARKET", venueMarketId: "pm-1", venueOutcomeId: "yes" });
      }
    });

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "yes",
      side: "buy",
      quantity: 1,
      readMode: "cached_display",
      displayMaxAgeMs: 45_000
    });

    expect(report.snapshots.map((entry) => entry.venue)).toEqual(["POLYMARKET"]);
    expect(getDisplayCalls[0]).toMatchObject({
      venue: "POLYMARKET",
      venueMarketId: "pm-1",
      venueOutcomeId: "yes",
      maxAgeMs: 45_000
    });
    expect(getDisplayCalls[0]).not.toMatchObject({
      includeDbFallback: false
    });
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
        detailsCode: "Predict_market_orderbook_payload_validation_failed.",
        venueMarketId: "predict-1",
        venueOutcomeId: "yes"
      }
    ]);
  });
});

describe("venue quote mapping resolvers", () => {
  it("caches and coalesces approved venue mapping readiness lookups", async () => {
    let calls = 0;
    let now = new Date("2026-05-10T12:00:00.000Z");
    let resolveRows!: (rows: any[]) => void;
    const pendingRows = new Promise<any[]>((resolve) => {
      resolveRows = resolve;
    });
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        calls += 1;
        if (calls === 1) {
          return pendingRows;
        }
        return [{
          venue: "LIMITLESS",
          venue_market_id: "LIMITLESS:market-2:curated",
          normalized_payload: { venueMarketId: "market-2" },
          raw_source_payload: {}
        }];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }, {
      cacheTtlMs: 1_000,
      now: () => now
    });

    const first = resolver.getReadiness({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });
    const second = resolver.getReadiness({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });
    resolveRows([{
      venue: "LIMITLESS",
      venue_market_id: "LIMITLESS:market-1:curated",
      normalized_payload: { venueMarketId: "market-1" },
      raw_source_payload: {}
    }]);

    const [firstRows, secondRows] = await Promise.all([first, second]);
    const cachedRows = await resolver.getReadiness({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });
    now = new Date("2026-05-10T12:00:02.000Z");
    const refreshedRows = await resolver.getReadiness({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });

    expect(calls).toBe(2);
    expect(firstRows[0]?.venueMarketId).toBe("market-1");
    expect(secondRows[0]?.venueMarketId).toBe("market-1");
    expect(cachedRows[0]?.venueMarketId).toBe("market-1");
    expect(refreshedRows[0]?.venueMarketId).toBe("market-2");
  });

  it("primes terminal outcome mapping cache from approved readiness lists", async () => {
    let directMappingCalls = 0;
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        directMappingCalls += 1;
        return [];
      },
      async listApprovedVenueMappings() {
        return [
          {
            requested_canonical_market_id: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
            canonical_event_id: "event-btc-ath",
            canonical_market_id: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
            title: "BTC ATH by June 30",
            canonical_category: "CRYPTO",
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:bitcoin-all-time-high-by-june-30-2026:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
            normalized_payload: {
              venueMarketId: "bitcoin-all-time-high-by-june-30-2026",
              quoteMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
              quoteOutcomeTokenIds: {
                YES: "yes-token",
                NO: "no-token"
              }
            },
            raw_source_payload: {}
          }
        ];
      }
    });

    const listed = await resolver.listApprovedReadiness({ limit: 50 });
    const yesRoute = await resolver.resolve({
      canonicalMarketId: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
      canonicalOutcomeId: "yes"
    });
    const noRoute = await resolver.resolve({
      canonicalMarketId: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30",
      canonicalOutcomeId: "NO"
    });
    const venueScopedRoute = await resolver.resolve({
      canonicalMarketId: "FRONTEND_CURATED:CRYPTO|ATH_BY_DATE|BTC|2026-06-30|2026_06_30:POLYMARKET",
      canonicalOutcomeId: "yes"
    });

    expect(listed).toHaveLength(1);
    expect(directMappingCalls).toBe(0);
    expect(yesRoute).toEqual([{
      venue: "POLYMARKET",
      venueMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
      venueOutcomeId: "yes-token"
    }]);
    expect(noRoute).toEqual([{
      venue: "POLYMARKET",
      venueMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
      venueOutcomeId: "no-token"
    }]);
    expect(venueScopedRoute).toEqual([{
      venue: "POLYMARKET",
      venueMarketId: "0x337ed4a919995ef9ba9d705b319055633a5dfdcb3ab97cf610009a7d11a9ade4",
      venueOutcomeId: "yes-token"
    }]);
  });

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

  it("extracts Opinion quote token ids from outcome arrays in shared-core payloads", async () => {
    const resolver = new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "OPINION",
            venue_market_id: "OPINION:market-123:canonical",
            normalized_payload: {
              venueMarketId: "market-123",
              outcomes: [
                { label: "Yes", tokenId: "opinion-yes-token" },
                { label: "No", token_id: "opinion-no-token" }
              ]
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
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES"
    })).resolves.toEqual([{
      venue: "OPINION",
      venueMarketId: "market-123",
      venueOutcomeId: "opinion-yes-token"
    }]);
  });

  it("returns typed quote-reader blockers for known provider failures", async () => {
    const timeoutReader: VenueQuoteSnapshotReader = {
      venue: "LIMITLESS",
      async getQuoteSnapshot() {
        throw new Error("request timeout while reading orderbook");
      }
    };
    const httpReader: VenueQuoteSnapshotReader = {
      venue: "POLYMARKET",
      async getQuoteSnapshot() {
        const error = new Error("provider unavailable");
        (error as Error & { status: number }).status = 503;
        throw error;
      }
    };
    const messageStatusReader: VenueQuoteSnapshotReader = {
      venue: "PREDICT",
      async getQuoteSnapshot() {
        throw new Error("Predict request failed with status 404.");
      }
    };
    const source = new CompositeVenueQuoteSource([timeoutReader, httpReader, messageStatusReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "LIMITLESS",
            venue_market_id: "LIMITLESS:market-1:canonical",
            normalized_payload: { venueMarketId: "market-1", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          },
          {
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:market-2:canonical",
            normalized_payload: { venueMarketId: "market-2", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          },
          {
            venue: "PREDICT",
            venue_market_id: "PREDICT:market-3:canonical",
            normalized_payload: { venueMarketId: "market-3", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          }
        ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }));

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.blocked.map((blocker) => blocker.reason).sort()).toEqual([
      "QUOTE_PROVIDER_HTTP_404",
      "QUOTE_PROVIDER_HTTP_503",
      "QUOTE_PROVIDER_TIMEOUT"
    ]);
    expect(report.blocked.every((blocker) => blocker.reason !== "QUOTE_READER_FAILED")).toBe(true);
  });

  it("does not let a slow venue reader block faster venue snapshots", async () => {
    const slowReader: VenueQuoteSnapshotReader = {
      venue: "LIMITLESS",
      async getQuoteSnapshot() {
        return await new Promise(() => undefined);
      }
    };
    const fastReader: VenueQuoteSnapshotReader = {
      venue: "POLYMARKET",
      async getQuoteSnapshot() {
        return {
          venue: "POLYMARKET",
          venueMarketId: "poly-fast",
          venueOutcomeId: "yes-token",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: null,
          receivedAt: new Date("2026-05-10T12:00:00.000Z"),
          bids: [{ price: "0.49", size: "10" }],
          asks: [{ price: "0.51", size: "12" }],
          blockers: [],
          missingFactors: []
        };
      }
    };
    const source = new CompositeVenueQuoteSource([slowReader, fastReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "LIMITLESS",
            venue_market_id: "LIMITLESS:slow-market:canonical",
            normalized_payload: { venueMarketId: "slow-market", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          },
          {
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:poly-fast:canonical",
            normalized_payload: { venueMarketId: "poly-fast", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          }
        ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }), () => new Date("2026-05-10T12:00:00.000Z"), undefined, { readerTimeoutMs: 1 });

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.snapshots).toHaveLength(1);
    expect(report.snapshots[0]?.venue).toBe("POLYMARKET");
    expect(report.blocked).toEqual([expect.objectContaining({
      venue: "LIMITLESS",
      reason: "QUOTE_PROVIDER_TIMEOUT"
    })]);
  });

  it("filters quote snapshot reads to requested venues when a recorder lane supplies a venue set", async () => {
    const calledVenues: string[] = [];
    const limitlessReader: VenueQuoteSnapshotReader = {
      venue: "LIMITLESS",
      async getQuoteSnapshot() {
        calledVenues.push("LIMITLESS");
        return await new Promise(() => undefined);
      }
    };
    const polymarketReader: VenueQuoteSnapshotReader = {
      venue: "POLYMARKET",
      async getQuoteSnapshot() {
        calledVenues.push("POLYMARKET");
        return {
          venue: "POLYMARKET",
          venueMarketId: "poly-fast",
          venueOutcomeId: "yes-token",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: null,
          receivedAt: new Date("2026-05-10T12:00:00.000Z"),
          bids: [{ price: "0.49", size: "10" }],
          asks: [{ price: "0.51", size: "12" }],
          blockers: [],
          missingFactors: []
        };
      }
    };
    const source = new CompositeVenueQuoteSource([limitlessReader, polymarketReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "LIMITLESS",
            venue_market_id: "LIMITLESS:slow-market:canonical",
            normalized_payload: { venueMarketId: "slow-market", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          },
          {
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:poly-fast:canonical",
            normalized_payload: { venueMarketId: "poly-fast", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          }
        ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }), () => new Date("2026-05-10T12:00:00.000Z"), undefined, { readerTimeoutMs: 1 });

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1,
      venues: ["POLYMARKET"]
    });

    expect(calledVenues).toEqual(["POLYMARKET"]);
    expect(report.snapshots.map((snapshot) => snapshot.venue)).toEqual(["POLYMARKET"]);
    expect(report.blocked).toEqual([]);
  });

  it("supports code-owned per-venue reader timeouts without raising the global timeout", async () => {
    const opinionReader: VenueQuoteSnapshotReader = {
      venue: "OPINION",
      async getQuoteSnapshot() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          venue: "OPINION",
          venueMarketId: "opinion-market",
          venueOutcomeId: "opinion-token",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: null,
          receivedAt: new Date("2026-05-10T12:00:00.000Z"),
          bids: [{ price: "0.49", size: "10" }],
          asks: [{ price: "0.51", size: "12" }],
          blockers: [],
          missingFactors: []
        };
      }
    };
    const limitlessReader: VenueQuoteSnapshotReader = {
      venue: "LIMITLESS",
      async getQuoteSnapshot() {
        return await new Promise(() => undefined);
      }
    };
    const source = new CompositeVenueQuoteSource([opinionReader, limitlessReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [
          {
            venue: "OPINION",
            venue_market_id: "OPINION:opinion-market:canonical",
            normalized_payload: { venueMarketId: "opinion-market", quoteTokenId: "opinion-token" },
            raw_source_payload: {}
          },
          {
            venue: "LIMITLESS",
            venue_market_id: "LIMITLESS:slow-market:canonical",
            normalized_payload: { venueMarketId: "slow-market", quoteTokenId: "yes-token" },
            raw_source_payload: {}
          }
        ];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }), () => new Date("2026-05-10T12:00:00.000Z"), undefined, {
      readerTimeoutMs: 1,
      perVenueReaderTimeoutMs: { OPINION: 50 }
    });

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.snapshots.map((snapshot) => snapshot.venue)).toEqual(["OPINION"]);
    expect(report.blocked).toEqual([expect.objectContaining({
      venue: "LIMITLESS",
      reason: "QUOTE_PROVIDER_TIMEOUT"
    })]);
  });

  it("keeps Predict 401 quote failures typed with an operator-safe auth details code", async () => {
    const predictReader: VenueQuoteSnapshotReader = {
      venue: "PREDICT_FUN",
      async getQuoteSnapshot() {
        throw new Error("Predict request failed with status 401.");
      }
    };
    const source = new CompositeVenueQuoteSource([predictReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [{
          venue: "PREDICT",
          venue_market_id: "PREDICT:58416:canonical",
          normalized_payload: { venueMarketId: "58416", quoteTokenId: "yes-token" },
          raw_source_payload: {}
        }];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }));

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.blocked).toEqual([{
      venue: "PREDICT",
      reason: "QUOTE_PROVIDER_HTTP_401",
      venueMarketId: "58416",
      venueOutcomeId: "yes-token",
      detailsCode: "PREDICT_PROVIDER_AUTH_INVALID"
    }]);
  });

  it("keeps Limitless inactive markets typed instead of generic HTTP 400", async () => {
    const limitlessReader: VenueQuoteSnapshotReader = {
      venue: "LIMITLESS",
      async getQuoteSnapshot() {
        throw new Error("Limitless orderbook request failed with status 400. Market is not active");
      }
    };
    const source = new CompositeVenueQuoteSource([limitlessReader], new SharedCoreVenueQuoteMappingResolver({
      async loadApprovedVenueMappings() {
        return [{
          venue: "LIMITLESS",
          venue_market_id: "LIMITLESS:market-1:canonical",
          normalized_payload: { venueMarketId: "market-1", quoteTokenId: "yes-token" },
          raw_source_payload: {}
        }];
      },
      async listApprovedVenueMappings() {
        return [];
      }
    }));

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.blocked).toEqual([{
      venue: "LIMITLESS",
      reason: "LIMITLESS_MARKET_NOT_ACTIVE",
      venueMarketId: "market-1",
      venueOutcomeId: "yes-token",
      detailsCode: "Limitless_orderbook_request_failed_with_status_400._Market_is_not_active"
    }]);
  });
});
