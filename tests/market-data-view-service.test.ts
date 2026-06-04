import { describe, expect, it } from "vitest";
import type { NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import { LiveMarketDataViewService } from "../src/services/market-data-view.service.js";

const snapshot = (input: {
  venue: string;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  receivedAt: Date;
  bid: string;
  ask: string;
}): NormalizedVenueQuoteSnapshot => ({
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
  source: "STREAM",
  quoteQuality: "FULL_DEPTH_STREAM",
  sourceTimestamp: input.receivedAt,
  receivedAt: input.receivedAt,
  bids: [{ price: input.bid, size: "100" }],
  asks: [{ price: input.ask, size: "100" }],
  missingFactors: [],
  blockers: [],
  metadata: {}
});

describe("LiveMarketDataViewService", () => {
  it("uses cache-only quote reads for display orderbooks", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const calls: unknown[] = [];
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async (input) => {
        calls.push(input);
        return {
          snapshots: [],
          blocked: [{
            venue: "POLYMARKET",
            reason: "QUOTE_SNAPSHOT_CACHE_MISS"
          }]
        };
      }
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "market-1",
      outcomeId: "YES"
    });

    expect(orderbook.status).toBe("blocked");
    expect(calls[0]).toMatchObject({
      canonicalMarketId: "market-1",
      canonicalOutcomeId: "YES",
      readMode: "cached_display"
    });
  });

  it("merges linked canonical market legs into one partial-live orderbook", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const calls: unknown[] = [];
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async (input) => {
        calls.push(input);
        if (input.canonicalMarketId === "market-poly") {
          return {
            snapshots: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              source: "STREAM",
              quoteQuality: "FULL_DEPTH_REST",
              sourceTimestamp: now,
              receivedAt: now,
              bestBid: "0.48",
              bestAsk: "0.50",
              midpoint: "0.49",
              spread: "0.02",
              topOfBookSize: "100",
              bids: [{ price: "0.48", size: "100" }],
              asks: [{ price: "0.50", size: "90" }],
              blockers: [],
              missingFactors: []
            }],
            blocked: []
          };
        }
        return {
          snapshots: [],
          blocked: [{
            venue: "LIMITLESS",
            reason: "QUOTE_SNAPSHOT_CACHE_MISS",
            venueMarketId: "limitless-1",
            venueOutcomeId: "yes"
          }]
        };
      }
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "event-1",
      canonicalMarketIds: ["market-poly", "market-limitless"],
      outcomeId: "yes"
    });

    expect(calls).toEqual([
      expect.objectContaining({ canonicalMarketId: "market-poly", canonicalOutcomeId: "YES" }),
      expect.objectContaining({ canonicalMarketId: "market-limitless", canonicalOutcomeId: "YES" })
    ]);
    expect(orderbook).toMatchObject({
      marketId: "event-1",
      outcomeId: "YES",
      status: "partial",
      bestAsk: "0.5",
      venues: [expect.objectContaining({ venue: "POLYMARKET", snapshotStatus: "live" })],
      blockers: [expect.objectContaining({ venue: "LIMITLESS", reason: "QUOTE_SNAPSHOT_CACHE_MISS" })]
    });
  });

  it("normalizes binary orderbook outcome casing so warmup and terminal requests share cache", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const calls: unknown[] = [];
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async (input) => {
        calls.push(input);
        return {
          snapshots: [snapshot({
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: "token-yes",
            receivedAt: now,
            bid: "0.48",
            ask: "0.50"
          })],
          blocked: []
        };
      }
    }, { now: () => now });

    const lower = await service.getOrderbook({
      marketId: "event-1",
      canonicalMarketIds: ["market-poly"],
      outcomeId: "yes"
    });
    const upper = await service.getOrderbook({
      marketId: "event-1",
      canonicalMarketIds: ["market-poly"],
      outcomeId: "YES"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ canonicalOutcomeId: "YES" });
    expect(lower.outcomeId).toBe("YES");
    expect(upper.outcomeId).toBe("YES");
    expect(upper.venues).toHaveLength(1);
  });

  it("does not let a slow linked market leg hide or visibly block a fast live orderbook leg", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async (input) => {
        if (input.canonicalMarketId === "market-slow") {
          return await new Promise(() => undefined);
        }
        return {
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-fast",
            venueOutcomeId: "yes",
            source: "STREAM",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: now,
            receivedAt: now,
            bestBid: "0.61",
            bestAsk: "0.63",
            midpoint: "0.62",
            spread: "0.02",
            topOfBookSize: "100",
            bids: [{ price: "0.61", size: "100" }],
            asks: [{ price: "0.63", size: "90" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        };
      }
    }, { now: () => now, orderbookLiveTimeoutMs: 50 });

    const orderbook = await service.getOrderbook({
      marketId: "event-fast",
      canonicalMarketIds: ["market-fast", "market-slow"],
      outcomeId: "yes"
    });

    expect(orderbook).toMatchObject({
      status: "partial",
      bestAsk: "0.63",
      venues: [expect.objectContaining({ venue: "POLYMARKET", snapshotStatus: "live" })],
      blockers: []
    });
  });

  it("preloads linked-market mapping readiness before bounded orderbook leg reads", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let preloaded = false;
    const calls: unknown[] = [];
    const service = new LiveMarketDataViewService({
      preloadMappingReadiness: async (inputs) => {
        calls.push(inputs);
        preloaded = true;
      },
      getQuoteSnapshotReport: async (input) => {
        if (!preloaded) {
          return await new Promise(() => undefined);
        }
        return {
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-fast",
            venueOutcomeId: "yes",
            source: "STREAM",
            quoteQuality: "FULL_DEPTH_STREAM",
            sourceTimestamp: now,
            receivedAt: now,
            bestBid: "0.61",
            bestAsk: "0.63",
            midpoint: "0.62",
            spread: "0.02",
            topOfBookSize: "100",
            bids: [{ price: "0.61", size: "100" }],
            asks: [{ price: "0.63", size: "90" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        };
      }
    }, { now: () => now, orderbookLiveTimeoutMs: 50 });

    const orderbook = await service.getOrderbook({
      marketId: "event-fast",
      canonicalMarketIds: ["market-fast", "market-peer"],
      outcomeId: "yes"
    });

    expect(calls).toEqual([[
      { canonicalMarketId: "market-fast", canonicalOutcomeId: "YES" },
      { canonicalMarketId: "market-peer", canonicalOutcomeId: "YES" }
    ]]);
    expect(orderbook).toMatchObject({
      status: "live",
      bestAsk: "0.63",
      venues: [expect.objectContaining({ venue: "POLYMARKET", snapshotStatus: "live" })]
    });
  });

  it("serves worker-fed live orderbook snapshots before mapping preload or quote fanout", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let preloadCalled = false;
    let quoteSourceCalled = false;
    const service = new LiveMarketDataViewService({
      preloadMappingReadiness: async () => {
        preloadCalled = true;
        await new Promise(() => undefined);
      },
      getQuoteSnapshotReport: async () => {
        quoteSourceCalled = true;
        return { snapshots: [], blocked: [] };
      }
    }, {
      now: () => now,
      orderbookLiveTimeoutMs: 50,
      liveOrderbookSource: {
        get: async () => [{
          venue: "POLYMARKET",
          venueMarketId: "poly-live",
          venueOutcomeId: "yes",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: now,
          receivedAt: now,
          bids: [{ price: "0.61", size: "100" }],
          asks: [{ price: "0.63", size: "90" }],
          blockers: [],
          missingFactors: []
        }]
      }
    });

    const orderbook = await service.getOrderbook({
      marketId: "event-fast",
      canonicalMarketIds: ["market-fast"],
      outcomeId: "yes"
    });

    expect(preloadCalled).toBe(false);
    expect(quoteSourceCalled).toBe(false);
    expect(orderbook).toMatchObject({
      status: "live",
      bestAsk: "0.63",
      venues: [expect.objectContaining({ venue: "POLYMARKET", snapshotStatus: "live" })]
    });
  });

  it("keeps recently streamed unchanged books live but marks old snapshots stale", async () => {
    const now = new Date("2026-05-10T12:00:15.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [
          {
            venue: "LIMITLESS",
            venueMarketId: "limitless-recent",
            venueOutcomeId: "yes",
            source: "STREAM",
            quoteQuality: "FULL_DEPTH_STREAM",
            sourceTimestamp: new Date("2026-05-10T12:00:06.000Z"),
            receivedAt: new Date("2026-05-10T12:00:06.000Z"),
            bestBid: "0.41",
            bestAsk: "0.43",
            midpoint: "0.42",
            spread: "0.02",
            topOfBookSize: "100",
            bids: [{ price: "0.41", size: "100" }],
            asks: [{ price: "0.43", size: "90" }],
            blockers: [],
            missingFactors: []
          },
          {
            venue: "POLYMARKET",
            venueMarketId: "poly-old",
            venueOutcomeId: "yes",
            source: "STREAM",
            quoteQuality: "FULL_DEPTH_STREAM",
            sourceTimestamp: new Date("2026-05-10T11:59:30.000Z"),
            receivedAt: new Date("2026-05-10T11:59:30.000Z"),
            bestBid: "0.39",
            bestAsk: "0.45",
            midpoint: "0.42",
            spread: "0.06",
            topOfBookSize: "100",
            bids: [{ price: "0.39", size: "100" }],
            asks: [{ price: "0.45", size: "90" }],
            blockers: [],
            missingFactors: []
          }
        ],
        blocked: []
      })
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "market-1",
      outcomeId: "yes"
    });

    expect(orderbook).toMatchObject({
      status: "partial",
      bestBid: "0.41",
      bestAsk: "0.43",
      venues: [expect.objectContaining({ venue: "LIMITLESS", snapshotStatus: "live" })],
      blockers: [expect.objectContaining({ venue: "POLYMARKET", reason: "LIVE_ORDERBOOK_REQUIRED" })]
    });
  });

  it("keeps recently materialized REST books live for terminal display", async () => {
    const now = new Date("2026-05-10T12:00:15.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [
          {
            venue: "POLYMARKET",
            venueMarketId: "poly-rest-recent",
            venueOutcomeId: "yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: null,
            receivedAt: new Date("2026-05-10T12:00:03.000Z"),
            bestBid: "0.39",
            bestAsk: "0.41",
            midpoint: "0.40",
            spread: "0.02",
            topOfBookSize: "100",
            bids: [{ price: "0.39", size: "100" }],
            asks: [{ price: "0.41", size: "90" }],
            blockers: [],
            missingFactors: []
          },
          {
            venue: "LIMITLESS",
            venueMarketId: "limitless-rest-old",
            venueOutcomeId: "yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: null,
            receivedAt: new Date("2026-05-10T11:59:30.000Z"),
            bestBid: "0.38",
            bestAsk: "0.42",
            midpoint: "0.40",
            spread: "0.04",
            topOfBookSize: "100",
            bids: [{ price: "0.38", size: "100" }],
            asks: [{ price: "0.42", size: "90" }],
            blockers: [],
            missingFactors: []
          }
        ],
        blocked: []
      })
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "market-1",
      outcomeId: "yes"
    });

    expect(orderbook).toMatchObject({
      status: "partial",
      bestBid: "0.39",
      bestAsk: "0.41",
      venues: [expect.objectContaining({ venue: "POLYMARKET", snapshotStatus: "live" })],
      blockers: [expect.objectContaining({ venue: "LIMITLESS", reason: "LIVE_ORDERBOOK_REQUIRED" })]
    });
  });

  it("uses cache-only quote reads for display batch quotes", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const calls: unknown[] = [];
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async (input) => {
        calls.push(input);
        return {
          snapshots: [],
          blocked: [{
            venue: "LIMITLESS",
            reason: "QUOTE_SNAPSHOT_CACHE_MISS"
          }]
        };
      }
    }, { now: () => now });

    const quotes = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });

    expect(quotes.quotes[0]?.status).toBe("unavailable");
    expect(calls[0]).toMatchObject({
      canonicalMarketId: "market-1",
      canonicalOutcomeId: "YES",
      readMode: "cached_display"
    });
  });

  it("keeps batch quote diagnostics in debug mode but hides them for user display mode", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [{
          venue: "POLYMARKET",
          venueMarketId: "poly-1",
          venueOutcomeId: "yes",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: now,
          receivedAt: now,
          bids: [{ price: "0.50", size: "100" }],
          asks: [{ price: "0.53", size: "100" }],
          blockers: [],
          missingFactors: []
        }],
        blocked: [{
          venue: "LIMITLESS",
          reason: "QUOTE_SNAPSHOT_CACHE_MISS"
        }]
      })
    }, { now: () => now });

    const debug = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    const userDisplay = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }],
      displayMode: "user"
    });

    expect(debug.quotes[0]).toMatchObject({
      status: "partial",
      bestVenue: "POLYMARKET",
      bestVenuePrice: "0.53",
      blockers: [expect.objectContaining({ venue: "LIMITLESS", reason: "QUOTE_SNAPSHOT_CACHE_MISS" })]
    });
    expect(userDisplay.quotes[0]).toMatchObject({
      status: "live",
      bestVenue: "POLYMARKET",
      bestVenuePrice: "0.53",
      blockers: []
    });
  });

  it("omits provider blockers from unavailable user display batch quotes", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [],
        blocked: [{
          venue: "PREDICT_FUN",
          reason: "QUOTE_PROVIDER_TIMEOUT"
        }]
      })
    }, { now: () => now });

    const userDisplay = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }],
      displayMode: "user"
    });

    expect(userDisplay.quotes[0]).toMatchObject({
      status: "unavailable",
      bestVenue: null,
      bestVenuePrice: null,
      blockers: []
    });
  });

  it("returns typed blocked orderbook status when every venue is blocked", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [],
        blocked: [{
          venue: "POLYMARKET",
          reason: "POLYMARKET_OFFICIAL_MARKET_CLOSED,POLYMARKET_OFFICIAL_MARKET_NOT_ACCEPTING_ORDERS",
          detailsCode: "poly-closed"
        }]
      })
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "market-closed",
      outcomeId: "YES"
    });

    expect(orderbook.status).toBe("blocked");
    expect(orderbook.blockers[0]).toMatchObject({
      venue: "POLYMARKET",
      reason: "POLYMARKET_OFFICIAL_MARKET_CLOSED,POLYMARKET_OFFICIAL_MARKET_NOT_ACCEPTING_ORDERS"
    });
  });

  it("does not expose all-stale orderbook snapshots as tradable depth", async () => {
    const now = new Date("2026-05-10T12:00:25.000Z");
    const staleAt = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService({
      getQuoteSnapshotReport: async () => ({
        snapshots: [{
          venue: "POLYMARKET",
          venueMarketId: "poly-1",
          venueOutcomeId: "yes",
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST",
          sourceTimestamp: staleAt,
          receivedAt: staleAt,
          bestBid: "0.70",
          bestAsk: "0.74",
          midpoint: "0.72",
          spread: "0.04",
          topOfBookSize: "100",
          bids: [{ price: "0.70", size: "100" }],
          asks: [{ price: "0.74", size: "100" }],
          blockers: [],
          missingFactors: []
        }],
        blocked: []
      })
    }, { now: () => now });

    const orderbook = await service.getOrderbook({
      marketId: "market-stale",
      outcomeId: "YES"
    });

    expect(orderbook.status).toBe("blocked");
    expect(orderbook.venues).toEqual([]);
    expect(orderbook.bestAsk).toBeNull();
    expect(orderbook.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ venue: "POLYMARKET", reason: "LIVE_ORDERBOOK_REQUIRED" })
    ]));
  });

  it("bounds slow orderbook reads so terminal loads do not wait on venue fanout", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => await new Promise(() => undefined)
      },
      {
        now: () => now,
        orderbookLiveTimeoutMs: 10
      }
    );

    const started = Date.now();
    const orderbook = await service.getOrderbook({
      marketId: "market-slow",
      outcomeId: "YES"
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(300);
    expect(orderbook.status).toBe("unavailable");
    expect(orderbook.blockers[0]).toMatchObject({
      venue: "LOTUS",
      reason: "MARKET_ORDERBOOK_REFRESH_DEFERRED"
    });
  });

  it("does not cache linked-leg deferred orderbooks over later live retries", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let calls = 0;
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async (input) => {
          calls += 1;
          if (calls <= 2) {
            return await new Promise(() => undefined);
          }
          return {
            snapshots: [snapshot({
              venue: input.canonicalMarketId === "market-poly" ? "POLYMARKET" : "LIMITLESS",
              venueMarketId: input.canonicalMarketId,
              venueOutcomeId: input.canonicalMarketId === "market-poly" ? "token-yes" : "YES",
              receivedAt: now,
              bid: input.canonicalMarketId === "market-poly" ? "0.48" : "0.47",
              ask: input.canonicalMarketId === "market-poly" ? "0.50" : "0.51"
            })],
            blocked: []
          };
        }
      },
      {
        now: () => now,
        orderbookLiveTimeoutMs: 10
      }
    );

    const first = await service.getOrderbook({
      marketId: "event-1",
      canonicalMarketIds: ["market-poly", "market-limitless"],
      outcomeId: "YES"
    });
    const second = await service.getOrderbook({
      marketId: "event-1",
      canonicalMarketIds: ["market-poly", "market-limitless"],
      outcomeId: "YES"
    });

    expect(first.status).toBe("blocked");
    expect(first.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ venue: "LOTUS", reason: "MARKET_ORDERBOOK_LEG_REFRESH_DEFERRED" })
    ]));
    expect(second.status).toBe("live");
    expect(second.bestAsk).toBe("0.5");
    expect(calls).toBeGreaterThan(2);
  });

  it("does not serve last-good orderbook prices when a later live refresh times out", async () => {
    let now = new Date("2026-05-10T12:00:00.000Z");
    let calls = 0;
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => {
          calls += 1;
          if (calls > 1) {
            return await new Promise(() => undefined);
          }
          return {
            snapshots: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              source: "REST",
              quoteQuality: "FULL_DEPTH_REST",
              sourceTimestamp: now,
              receivedAt: now,
              bids: [{ price: "0.50", size: "100" }],
              asks: [{ price: "0.53", size: "100" }],
              blockers: [],
              missingFactors: []
            }],
            blocked: []
          };
        }
      },
      {
        now: () => now,
        orderbookLiveTimeoutMs: 10
      }
    );

    const first = await service.getOrderbook({
      marketId: "market-1",
      outcomeId: "YES"
    });
    now = new Date(now.getTime() + 4_000);
    const second = await service.getOrderbook({
      marketId: "market-1",
      outcomeId: "YES"
    });

    expect(first.status).toBe("live");
    expect(first.bestAsk).toBe("0.53");
    expect(second.status).toBe("unavailable");
    expect(second.bestAsk).toBeNull();
    expect(second.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ venue: "LOTUS", reason: "MARKET_ORDERBOOK_REFRESH_DEFERRED" })
    ]));
  });

  it("merges historical chart movement with the live point and inverts binary No history", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: "yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: now,
            receivedAt: now,
            bestBid: "0.70",
            bestAsk: "0.74",
            midpoint: "0.72",
            spread: "0.04",
            topOfBookSize: "100",
            bids: [{ price: "0.70", size: "100" }],
            asks: [{ price: "0.74", size: "100" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        })
      },
      {
        now: () => now,
        historicalChartSource: {
          listChartPoints: async () => [
            { timestamp: new Date("2026-05-10T11:56:00.000Z"), venue: "POLYMARKET", value: "0.20" },
            { timestamp: new Date("2026-05-10T11:58:00.000Z"), venue: "POLYMARKET", value: "0.35" }
          ]
        }
      }
    );

    const chart = await service.getChart({
      marketId: "market-1",
      canonicalEventId: "event-1",
      venueMarketIds: ["poly-1"],
      outcomeId: "NO",
      outcomeLabel: "No",
      timeframe: "1H"
    });

    expect(chart.historyStatus).toBe("live");
    expect(chart.points.map((point) => point.unified)).toContain("0.8");
    expect(chart.points.map((point) => point.unified)).toContain("0.65");
    expect(chart.points.at(-1)?.unified).toBe("0.72");
  });

  it("keeps chart history available when the live orderbook read fails", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => {
          throw new Error("QUOTE_PROVIDER_HTTP_404");
        }
      },
      {
        now: () => now,
        historicalChartSource: {
          listChartPoints: async () => [
            { timestamp: new Date("2026-05-10T11:56:00.000Z"), venue: "POLYMARKET", value: "0.20" },
            { timestamp: new Date("2026-05-10T11:58:00.000Z"), venue: "POLYMARKET", value: "0.35" }
          ]
        }
      }
    );

    const chart = await service.getChart({
      marketId: "market-1",
      canonicalEventId: "event-1",
      venueMarketIds: ["poly-1"],
      outcomeId: "YES",
      outcomeLabel: "Yes",
      timeframe: "1H"
    });

    expect(chart.historyStatus).toBe("live");
    expect(chart.points.map((point) => point.unified)).toEqual(["0.2", "0.35"]);
    expect(chart.blockers[0]).toMatchObject({
      venue: "LOTUS",
      reason: "LIVE_ORDERBOOK_UNAVAILABLE"
    });
  });

  it("bounds batch quote reads and refreshes cache after a slow live response resolves", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let resolveReport!: (value: any) => void;
    const pendingReport = new Promise<any>((resolve) => {
      resolveReport = resolve;
    });
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => pendingReport
      },
      {
        now: () => now,
        batchQuoteLiveTimeoutMs: 10
      }
    );

    const started = Date.now();
    const first = await service.getBatchQuotes({
      items: [{ marketId: "market-slow", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(300);
    expect(first.quotes[0]).toMatchObject({
      status: "unavailable",
      blockers: [{ venue: "LOTUS", reason: "MARKET_BATCH_QUOTE_REFRESH_DEFERRED" }]
    });

    resolveReport({
      snapshots: [{
        venue: "POLYMARKET",
        venueMarketId: "poly-1",
        venueOutcomeId: "yes",
        source: "REST",
        quoteQuality: "FULL_DEPTH_REST",
        sourceTimestamp: now,
        receivedAt: now,
        bids: [{ price: "0.50", size: "100" }],
        asks: [{ price: "0.53", size: "100" }],
        blockers: [],
        missingFactors: []
      }],
      blocked: []
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await service.getBatchQuotes({
      items: [{ marketId: "market-slow", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    expect(second.quotes[0]).toMatchObject({
      status: "live",
      bestVenue: "POLYMARKET",
      bestVenuePrice: "0.53"
    });
  });

  it("coalesces duplicate concurrent batch quote items", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let calls = 0;
    let resolveReport!: (value: any) => void;
    const pendingReport = new Promise<any>((resolve) => {
      resolveReport = resolve;
    });
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => {
          calls += 1;
          return pendingReport;
        }
      },
      {
        now: () => now,
        batchQuoteLiveTimeoutMs: 500
      }
    );

    const first = service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    const second = service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    resolveReport({
      snapshots: [{
        venue: "POLYMARKET",
        venueMarketId: "poly-1",
        venueOutcomeId: "yes",
        source: "REST",
        quoteQuality: "FULL_DEPTH_REST",
        sourceTimestamp: now,
        receivedAt: now,
        bids: [{ price: "0.50", size: "100" }],
        asks: [{ price: "0.53", size: "100" }],
        blockers: [],
        missingFactors: []
      }],
      blocked: []
    });

    const responses = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(responses[0].quotes[0]?.bestVenuePrice).toBe("0.53");
    expect(responses[1].quotes[0]?.bestVenuePrice).toBe("0.53");
  });

  it("does not cache unavailable batch quote misses over later live snapshots", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    let calls = 0;
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              snapshots: [],
              blocked: [{
                venue: "LIMITLESS",
                reason: "QUOTE_SNAPSHOT_CACHE_MISS"
              }]
            };
          }
          return {
            snapshots: [{
              venue: "LIMITLESS",
              venueMarketId: "limitless-1",
              venueOutcomeId: "YES",
              source: "REST",
              quoteQuality: "FULL_DEPTH_REST",
              sourceTimestamp: now,
              receivedAt: now,
              bids: [{ price: "0.50", size: "100" }],
              asks: [{ price: "0.53", size: "100" }],
              blockers: [],
              missingFactors: []
            }],
            blocked: []
          };
        }
      },
      {
        now: () => now,
        batchQuoteLiveTimeoutMs: 500
      }
    );

    const first = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    const second = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });

    expect(calls).toBe(2);
    expect(first.quotes[0]).toMatchObject({
      status: "unavailable",
      blockers: [expect.objectContaining({ reason: "QUOTE_SNAPSHOT_CACHE_MISS" })]
    });
    expect(second.quotes[0]).toMatchObject({
      status: "live",
      bestVenue: "LIMITLESS",
      bestVenuePrice: "0.53"
    });
  });

  it("serves the last usable batch quote while refreshing in the background", async () => {
    let now = new Date("2026-05-10T12:00:00.000Z");
    let calls = 0;
    let resolveRefresh!: (value: any) => void;
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              snapshots: [{
                venue: "POLYMARKET",
                venueMarketId: "poly-1",
                venueOutcomeId: "yes",
                source: "REST",
                quoteQuality: "FULL_DEPTH_REST",
                sourceTimestamp: now,
                receivedAt: now,
                bids: [{ price: "0.50", size: "100" }],
                asks: [{ price: "0.53", size: "100" }],
                blockers: [],
                missingFactors: []
              }],
              blocked: []
            };
          }
          return await new Promise((resolve) => {
            resolveRefresh = resolve;
          });
        }
      },
      {
        now: () => now,
        batchQuoteLiveTimeoutMs: 500
      }
    );

    const first = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    now = new Date("2026-05-10T12:00:05.000Z");
    const started = Date.now();
    const second = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    const elapsedMs = Date.now() - started;

    expect(first.quotes[0]).toMatchObject({ status: "live", bestVenuePrice: "0.53" });
    expect(elapsedMs).toBeLessThan(100);
    expect(calls).toBe(2);
    expect(second.quotes[0]).toMatchObject({
      status: "live",
      bestVenue: "POLYMARKET",
      bestVenuePrice: "0.53",
      blockers: []
    });

    resolveRefresh({
      snapshots: [{
        venue: "POLYMARKET",
        venueMarketId: "poly-1",
        venueOutcomeId: "yes",
        source: "STREAM",
        quoteQuality: "FULL_DEPTH_STREAM",
        sourceTimestamp: now,
        receivedAt: now,
        bids: [{ price: "0.51", size: "100" }],
        asks: [{ price: "0.54", size: "100" }],
        blockers: [],
        missingFactors: []
      }],
      blocked: []
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const refreshed = await service.getBatchQuotes({
      items: [{ marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1" }]
    });
    expect(refreshed.quotes[0]).toMatchObject({ status: "live", bestVenuePrice: "0.54" });
  });

  it("bounds chart reads when live orderbook and stored history are slow", async () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const service = new LiveMarketDataViewService(
      {
        getQuoteSnapshotReport: async () => await new Promise(() => undefined)
      },
      {
        now: () => now,
        historicalChartSource: {
          listChartPoints: async () => await new Promise(() => undefined)
        }
      }
    );

    const started = Date.now();
    const chart = await service.getChart({
      marketId: "market-slow",
      canonicalEventId: "event-slow",
      venueMarketIds: ["poly-1"],
      outcomeId: "YES",
      outcomeLabel: "Yes",
      timeframe: "1H"
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(300);
    expect(chart.historyStatus).toBe("unavailable");
    expect(chart.blockers[0]).toMatchObject({
      venue: "LOTUS",
      reason: "LIVE_ORDERBOOK_TIMEOUT"
    });
  });
});
