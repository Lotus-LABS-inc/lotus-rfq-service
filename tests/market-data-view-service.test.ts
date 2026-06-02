import { describe, expect, it } from "vitest";
import { LiveMarketDataViewService } from "../src/services/market-data-view.service.js";

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

  it("marks all-stale orderbook snapshots as stale display data", async () => {
    const now = new Date("2026-05-10T12:00:05.000Z");
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

    expect(orderbook.status).toBe("stale");
    expect(orderbook.venues[0]?.snapshotStatus).toBe("stale");
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
      reason: "MARKET_ORDERBOOK_TIMEOUT"
    });
  });

  it("serves last-good orderbook display data when a later live refresh times out", async () => {
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

    expect(first.status).toBe("stale");
    expect(first.bestAsk).toBe("0.53");
    expect(second.status).toBe("stale");
    expect(second.bestAsk).toBe("0.53");
    expect(second.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ venue: "LOTUS", reason: "LAST_GOOD_ORDERBOOK_USED" })
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
      blockers: [{ venue: "LOTUS", reason: "MARKET_BATCH_QUOTE_TIMEOUT" }]
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
