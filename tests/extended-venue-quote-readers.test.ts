import { describe, expect, it } from "vitest";
import { calculateVenueQuote, QuoteSnapshotCache } from "../src/core/sor/quote-snapshot.js";
import { normalizeMyriadQuote } from "../src/integrations/myriad/myriad-quote-reader.js";
import { normalizeOpinionOrderbook, OpinionQuoteReader, parseOpinionTopicRate } from "../src/integrations/opinion/opinion-quote-reader.js";
import { normalizePredictOrderbook, PredictQuoteReader } from "../src/integrations/predict/predict-quote-reader.js";
import { LimitlessQuoteReader } from "../src/integrations/limitless/limitless-quote-reader.js";
import { PolymarketQuoteReader, resolveOutcomeTokenFromGammaMarkets } from "../src/integrations/polymarket/polymarket-quote-reader.js";
import { MyriadQuoteReader } from "../src/integrations/myriad/myriad-quote-reader.js";
import { parsePredictMarketOrderbookResponse } from "../src/integrations/predict/predict-schemas.js";

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
      venueOutcomeId: "1001",
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

  it("normalizes Predict.fun tuple orderbook levels from the venue API", () => {
    const parsed = parsePredictMarketOrderbookResponse({
      data: {
        marketId: "predict-market-1",
        bids: [[0.487, 16.8867]],
        asks: [[0.508, 437.93]]
      } as never
    });
    const snapshot = normalizePredictOrderbook({
      payload: {
        bids: [[0.487, 16.8867]],
        asks: [[0.508, 437.93]],
        timestamp: now.toISOString()
      },
      venueMarketId: "predict-market-1",
      venueOutcomeId: "1001",
      receivedAt: now,
      environment: "mainnet",
      venueFeeBps: 25
    });

    const calculated = calculateVenueQuote({ snapshot, side: "buy", amount: 1, now });

    expect(parsed.bids[0]).toMatchObject({ price: "0.487", size: "16.8867" });
    expect(parsed.asks[0]).toMatchObject({ price: "0.508", size: "437.93" });
    expect(snapshot.bids[0]).toEqual({ price: "0.487", size: "16.8867" });
    expect(snapshot.asks[0]).toEqual({ price: "0.508", size: "437.93" });
    expect(calculated.ok).toBe(true);
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
      } as never
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      venueMarketId: "predict-market-1",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.venueFeeBps).toBe(35);
    expect(snapshot?.venueFeeModel).toBe("PREDICT_MARKET_STATS");
    expect(snapshot?.blockers).toContain("PREDICT_FUN_TOKEN_ID_MISSING");
  });

  it("Predict.fun reader resolves missing binary outcome ids from market detail and inverts NO", async () => {
    const reader = new PredictQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      environment: "mainnet",
      now: () => now,
      client: {
        async getMarketOrderbook() {
          return { bids: [{ price: "0.48", size: "10" }], asks: [{ price: "0.51", size: "10" }] };
        },
        async getMarketStatistics() {
          return { feeRateBps: "35" };
        },
        async getMarketById() {
          return {
            id: "predict-market-1",
            title: "Market",
            outcomes: [
              { label: "Yes", tokenId: "1001" },
              { label: "No", tokenId: "1002" }
            ]
          };
        }
      } as never
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "NO",
      venueMarketId: "predict-market-1",
      side: "buy",
      quantity: 1
    });
    const calculated = calculateVenueQuote({ snapshot: snapshot!, side: "buy", amount: 1, now });

    expect(snapshot?.venue).toBe("PREDICT_FUN");
    expect(snapshot?.venueOutcomeId).toBe("1002");
    expect(snapshot?.metadata).toMatchObject({ outcomeSide: "NO" });
    expect(calculated.price).toBe(0.52);
  });

  it("Predict.fun reader treats YES/NO shared-core labels as labels, not executable token ids", async () => {
    const reader = new PredictQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      environment: "mainnet",
      now: () => now,
      client: {
        async getMarketOrderbook() {
          return { bids: [{ price: "0.38", size: "10" }], asks: [{ price: "0.39", size: "10" }] };
        },
        async getMarketStatistics() {
          return { feeRateBps: "35" };
        },
        async getMarketById() {
          return {
            id: "14347",
            title: "Market",
            outcomes: [
              { label: "Yes", tokenId: "875841741480746520604679210811814028357467302712417806610111179101805869578687" },
              { label: "No", tokenId: "242424242424242424242424242424242424242424242424242424242424242424" }
            ]
          };
        }
      } as never
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venueMarketId: "14347",
      venueOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.venueOutcomeId).toBe("875841741480746520604679210811814028357467302712417806610111179101805869578687");
    expect(snapshot?.blockers).not.toContain("PREDICT_FUN_TOKEN_ID_MISSING");
    expect(snapshot?.metadata).toMatchObject({ outcomeSide: "YES" });
  });

  it("Predict.fun reader blocks execution quotes when an executable token id is unresolved", async () => {
    const reader = new PredictQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      environment: "mainnet",
      now: () => now,
      client: {
        async getMarketOrderbook() {
          return { bids: [{ price: "0.48", size: "10" }], asks: [{ price: "0.51", size: "10" }] };
        },
        async getMarketStatistics() {
          return { feeRateBps: "35" };
        },
        async getMarketById() {
          return {
            id: "predict-market-1",
            title: "Market",
            outcomes: [{ label: "Maybe", tokenId: "maybe-token" }]
          };
        }
      } as never
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "NO",
      venueMarketId: "predict-market-1",
      side: "buy",
      quantity: 1
    });
    const calculated = calculateVenueQuote({ snapshot: snapshot!, side: "buy", amount: 1, now });

    expect(snapshot?.blockers).toContain("PREDICT_FUN_TOKEN_ID_MISSING");
    expect(calculated.ok).toBe(false);
    expect(calculated.blockers).toContain("PREDICT_FUN_TOKEN_ID_MISSING");
  });

  it("Limitless reader fetches full market tokens and inverts YES book for NO outcome", async () => {
    const reader = new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getMarketDetail() {
          return {
            tokens: {
              yes: "yes-token",
              no: "no-token"
            }
          };
        },
        async getOrderbook() {
          return {
            bids: [{ price: 0.48, size: "10" }],
            asks: [{ price: 0.51, size: "10" }]
          };
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "NO",
      venueMarketId: "limitless-market-1",
      side: "buy",
      quantity: 1
    });
    const calculated = calculateVenueQuote({ snapshot: snapshot!, side: "buy", amount: 1, now });

    expect(snapshot?.venueOutcomeId).toBe("no-token");
    expect(snapshot?.metadata).toMatchObject({ outcomeSide: "NO" });
    expect(calculated.price).toBe(0.52);
  });

  it("Limitless reader resolves group markets to the canonical child market before reading orderbook", async () => {
    const requestedMarkets: string[] = [];
    const feeMarkets: string[] = [];
    const reader = new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getMarketDetail() {
          return {
            slug: "democratic-presidential-nominee-2028-1768929458278",
            marketType: "group",
            markets: [
              { slug: "jon-ossoff-1768927395480", title: "Jon Ossoff" },
              {
                slug: "gavin-newsom-1768927395479",
                title: "Gavin Newsom",
                venue: {
                  exchange: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47",
                  adapter: "0x0000000000000000000000000000000000000002"
                }
              }
            ]
          };
        },
        async getOrderbook(input: { marketId: string }) {
          requestedMarkets.push(input.marketId);
          return {
            tokenId: "gavin-token",
            bids: [{ price: 0.24, size: "10" }],
            asks: [{ price: 0.25, size: "10" }]
          };
        }
      },
      feeReader: {
        async getFeeBps(input: { marketSlug: string }) {
          feeMarkets.push(input.marketSlug);
          return 0;
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "FRONTEND_CURATED:NOMINEE|US_PRESIDENT|2028|DEMOCRATIC|GAVIN_NEWSOM",
      canonicalOutcomeId: "NO",
      venueMarketId: "democratic-presidential-nominee-2028-1768929458278",
      side: "buy",
      quantity: 1
    });

    expect(requestedMarkets).toEqual(["gavin-newsom-1768927395479"]);
    expect(feeMarkets).toEqual(["gavin-newsom-1768927395479"]);
    expect(snapshot?.venueMarketId).toBe("gavin-newsom-1768927395479");
    expect(snapshot?.venueOutcomeId).toBe("gavin-token");
    expect(snapshot?.asks[0]?.price).toBe("0.76");
    expect(snapshot?.metadata).toMatchObject({
      approvedVenueMarketId: "democratic-presidential-nominee-2028-1768929458278",
      venueMarketId: "gavin-newsom-1768927395479",
      venueOutcomeId: "gavin-token",
      outcomeSide: "NO",
      limitlessExchangeAddress: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47",
      limitlessAdapterAddress: "0x0000000000000000000000000000000000000002"
    });
  });

  it("Limitless reader hydrates parent group markets before resolving colon-scoped outcomes", async () => {
    const detailMarkets: string[] = [];
    const requestedMarkets: string[] = [];
    const reader = new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getMarketDetail(marketId: string) {
          detailMarkets.push(marketId);
          return {
            slug: "uefa-champions-league-winner-1765297468263",
            marketType: "group",
            markets: [
              { slug: "real-madrid-1765297468001", title: "Real Madrid" },
              { slug: "paris-saint-germain-1765297468002", title: "Paris Saint Germain" }
            ]
          };
        },
        async getOrderbook(input: { marketId: string }) {
          requestedMarkets.push(input.marketId);
          return {
            tokenId: "psg-token",
            bids: [{ price: 0.56, size: "10" }],
            asks: [{ price: 0.57, size: "10" }]
          };
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "FRONTEND_CURATED:SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026|PARIS_SAINT_GERMAIN",
      canonicalOutcomeId: "YES",
      venueMarketId: "uefa-champions-league-winner-1765297468263:psg",
      side: "buy",
      quantity: 1
    });

    expect(detailMarkets).toEqual(["uefa-champions-league-winner-1765297468263"]);
    expect(requestedMarkets).toEqual(["paris-saint-germain-1765297468002"]);
    expect(snapshot?.venueMarketId).toBe("paris-saint-germain-1765297468002");
    expect(snapshot?.metadata).toMatchObject({
      approvedVenueMarketId: "uefa-champions-league-winner-1765297468263:psg",
      venueMarketId: "paris-saint-germain-1765297468002"
    });
  });

  it("Limitless reader enriches stream cache snapshots with market exchange metadata", async () => {
    const streamCache = new QuoteSnapshotCache();
    streamCache.put({
      venue: "LIMITLESS",
      venueMarketId: "alexandria-ocasio-cortez-1768927395488",
      venueOutcomeId: "yes-token",
      source: "STREAM",
      quoteQuality: "FULL_DEPTH_STREAM",
      sourceTimestamp: now,
      receivedAt: now,
      bids: [{ price: "0.08", size: "10" }],
      asks: [{ price: "0.09", size: "10" }],
      metadata: {
        venueMarketId: "alexandria-ocasio-cortez-1768927395488",
        venueOutcomeId: "yes-token"
      }
    });
    const reader = new LimitlessQuoteReader({
      streamCache,
      now: () => now,
      client: {
        async getMarketDetail() {
          return {
            slug: "alexandria-ocasio-cortez-1768927395488",
            venue: {
              exchange: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47",
              adapter: "0x6151EF8368b6316c1aa3C68453EF083ad31E712D"
            }
          };
        },
        async getOrderbook() {
          throw new Error("stream cache should avoid orderbook reads");
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "FRONTEND_CURATED:NOMINEE|US_PRESIDENT|2028|DEMOCRATIC|ALEXANDRIA_OCASIO_CORTEZ:LIMITLESS",
      canonicalOutcomeId: "YES",
      venueMarketId: "alexandria-ocasio-cortez-1768927395488",
      venueOutcomeId: "yes-token",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.source).toBe("STREAM");
    expect(snapshot?.metadata).toMatchObject({
      limitlessExchangeAddress: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47",
      limitlessAdapterAddress: "0x6151EF8368b6316c1aa3C68453EF083ad31E712D"
    });
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

  it("Opinion reader treats numeric market ids as token ids when no separate outcome id exists", async () => {
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
      venueMarketId: "12345",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.venueOutcomeId).toBe("12345");
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

  it("Myriad reader resolves missing outcome ids from market detail before quote", async () => {
    let requestedOutcomeId: unknown = null;
    const reader = new MyriadQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getMarket() {
          return {
            id: "myriad-market-1",
            networkId: 1,
            slug: "myriad-market-1",
            title: "Market",
            state: "open",
            topics: [],
            outcomes: [
              { id: 0, title: "Yes", price: 0.4 },
              { id: 1, title: "No", price: 0.6 }
            ]
          };
        },
        async getMarketQuote(input) {
          requestedOutcomeId = input.outcome_id;
          return {
            price_average: 0.6,
            price_before: 0.59,
            price_after: 0.61,
            shares: 1,
            fees: { fee: 0.01 }
          };
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "NO",
      venueMarketId: "myriad-market-1",
      side: "buy",
      quantity: 1
    });

    expect(requestedOutcomeId).toBe(1);
    expect(snapshot?.venueOutcomeId).toBe("1");
  });

  it("Polymarket reader resolves missing CLOB tokens from official Gamma metadata", async () => {
    const token = resolveOutcomeTokenFromGammaMarkets([{
      conditionId: "0xcondition",
      marketId: "123",
      marketSlug: "market-slug",
      title: "Market",
      raw: {
        outcomes: [
          { label: "Yes", token_id: "yes-token" },
          { label: "No", token_id: "no-token" }
        ]
      }
    }], "NO");

    expect(token).toEqual({ venueOutcomeId: "no-token", outcomeLabel: "No" });
  });

  it("Polymarket reader fetches Gamma before CLOB when shared core lacks token id", async () => {
    let requestedTokenId: string | null = null;
    const reader = new PolymarketQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getOrderbook(input) {
          requestedTokenId = input.tokenId;
          return {
            bids: [{ price: "0.49", size: "10" }],
            asks: [{ price: "0.51", size: "10" }]
          };
        }
      },
      metadataClient: {
        async getMarketByIdentifier() {
          return [{
            conditionId: "0xcondition",
            marketId: "123",
            marketSlug: "market-slug",
            title: "Market",
            raw: {
              outcomes: [
                { label: "Yes", token_id: "yes-token" },
                { label: "No", token_id: "no-token" }
              ],
              tick_size: "0.001",
              neg_risk: true
            }
          }];
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "NO",
      venueMarketId: "market-slug",
      side: "buy",
      quantity: 1
    });

    expect(requestedTokenId).toBe("no-token");
    expect(snapshot?.venueOutcomeId).toBe("no-token");
    expect(snapshot?.metadata).toMatchObject({
      tickSize: "0.001",
      polymarketTickSize: "0.001",
      negRisk: true,
      polymarketNegRisk: true
    });
  });

  it("Polymarket reader returns display-only metadata prices when CLOB book is disabled", async () => {
    const reader = new PolymarketQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      now: () => now,
      client: {
        async getOrderbook() {
          throw new Error("Polymarket orderbook request failed with status 404.");
        }
      },
      metadataClient: {
        async getMarketByIdentifier() {
          return [{
            conditionId: "0xcondition",
            marketId: "123",
            marketSlug: "will-barcelona-win-la-liga",
            title: "Will Barcelona win La Liga?",
            raw: {
              active: true,
              closed: true,
              accepting_orders: false,
              enable_order_book: false,
              outcomes: "[\"Yes\", \"No\"]",
              clobTokenIds: "[\"yes-token\", \"no-token\"]",
              outcomePrices: "[\"1\", \"0\"]",
              orderPriceMinTickSize: "0.01",
              negRisk: false
            }
          }];
        }
      }
    });

    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venueMarketId: "0xcondition",
      venueOutcomeId: "yes-token",
      side: "buy",
      quantity: 1
    });

    expect(snapshot?.quoteQuality).toBe("INDICATIVE_DEPTH");
    expect(snapshot?.asks[0]).toEqual({ price: "1", size: "0" });
    expect(snapshot?.blockers).toContain("ORDERBOOK_UNAVAILABLE_DISPLAY_ONLY");
    expect(snapshot?.metadata).toMatchObject({
      tickSize: "0.01",
      polymarketTickSize: "0.01",
      negRisk: false,
      polymarketNegRisk: false
    });
    expect(calculateVenueQuote({
      snapshot: snapshot!,
      side: "buy",
      amount: 1,
      now
    }).ok).toBe(false);
  });
});
