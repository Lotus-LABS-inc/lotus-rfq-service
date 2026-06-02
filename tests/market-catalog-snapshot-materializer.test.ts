import { describe, expect, it, vi } from "vitest";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../src/repositories/market-catalog.repository.js";
import type { MarketCatalogSnapshotCache } from "../src/services/market-catalog-snapshot-cache.js";
import {
  marketCatalogDetailCacheKey,
  MarketCatalogSnapshotMaterializer,
  stableQueryCacheKey
} from "../src/services/market-catalog-snapshot-materializer.js";

const baseMarket: MarketCatalogMarket = {
  eventId: "event-1",
  eventTitle: "Event 1",
  canonicalEventId: "event-1",
  canonicalMarketIds: ["market-1"],
  displayTopic: "Event 1",
  displayOutcome: "Yes",
  displayOutcomeKey: "YES",
  title: "Event 1",
  normalizedTitle: "event 1",
  category: "POLITICS",
  marketClass: "BINARY",
  status: "OPEN",
  startsAt: null,
  expiresAt: null,
  resolvesAt: null,
  venues: ["POLYMARKET", "LIMITLESS"],
  venueCount: 2,
  venueMarketCount: 2,
  outcomeCount: 2,
  routeability: {
    hasSingleVenue: true,
    hasCrossVenue: true
  },
  imageUrl: null,
  iconUrl: null,
  volume: "0",
  volume24h: "0",
  liquidity: "0",
  buyVolume: "0",
  sellVolume: "0",
  tradeCount: "0",
  buyCount: "0",
  sellCount: "0",
  venueMarkets: [],
  updatedAt: "2026-06-01T00:00:00.000Z"
};

class FakeSnapshotCache implements MarketCatalogSnapshotCache {
  public readonly values = new Map<string, unknown>();

  public async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

describe("MarketCatalogSnapshotMaterializer", () => {
  it("prebuilds quote-ready market snapshots for frontend catalog keys", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const repository: Pick<MarketCatalogRepository, "listMarkets"> = {
      listMarkets: vi.fn(async () => [baseMarket])
    };
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [{
          canonicalMarketId: "market-1",
          quoteStatus: "live" as const,
          quoteReadyVenueCount: 2,
          quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
          quoteBlockers: [],
          lastQuoteAt: "2026-06-01T00:00:00.000Z"
        }])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all", "pair"], categories: [], intervalMs: 60_000 }
    });

    const result = await materializer.runOnce();

    expect(result).toMatchObject({ attempted: 6, written: 12, failed: 0 });
    const allMarketKey = `markets:${stableQueryCacheKey({ limit: 80 })}`;
    expect(snapshotCache.values.get(allMarketKey)).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{ quoteReadyVenueCount: 2, quoteReadyVenues: ["LIMITLESS", "POLYMARKET"] }]
    });
    const compactAllMarketKey = `markets:${stableQueryCacheKey({ limit: 80, view: "compact" })}`;
    expect(snapshotCache.values.get(compactAllMarketKey)).toMatchObject({
      count: 1,
      materialized: true,
      view: "compact",
      markets: [{ quoteReadyVenueCount: 2, quoteReadyVenues: ["LIMITLESS", "POLYMARKET"] }]
    });
    expect(JSON.stringify(snapshotCache.values.get(compactAllMarketKey))).not.toContain("venueMarkets");
    expect(snapshotCache.values.get(marketCatalogDetailCacheKey("market-1"))).toMatchObject({
      materialized: true,
      market: { canonicalMarketIds: ["market-1"], quoteReadyVenueCount: 2 }
    });
    expect(snapshotCache.values.get(marketCatalogDetailCacheKey("market-1:POLYMARKET"))).toMatchObject({
      materialized: true,
      market: { canonicalMarketIds: ["market-1"], quoteReadyVenueCount: 2 }
    });
    const key = `markets:${stableQueryCacheKey({ limit: 80, quoteReadyOnly: true, routeCoverage: "pair" })}`;
    expect(snapshotCache.values.get(key)).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{ quoteReadyVenueCount: 2, quoteReadyVenues: ["LIMITLESS", "POLYMARKET"] }]
    });
  });

  it("does not cache empty quote-ready snapshots", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets: vi.fn(async () => [baseMarket])
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: [], intervalMs: 60_000 }
    });

    const result = await materializer.runOnce();

    expect(result).toMatchObject({ attempted: 5, written: 6, skippedEmptyQuoteReady: 2 });
    expect(snapshotCache.values.get(`markets:${stableQueryCacheKey({ limit: 80 })}`)).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{ quoteStatus: "unavailable", quoteReadyVenueCount: 0 }]
    });
    expect(snapshotCache.values.get(`markets:${stableQueryCacheKey({ limit: 80, view: "compact" })}`)).toMatchObject({
      count: 1,
      materialized: true,
      view: "compact",
      markets: [{ quoteStatus: "unavailable", quoteReadyVenueCount: 0 }]
    });
    expect(snapshotCache.values.get(`markets:${stableQueryCacheKey({ limit: 80, quoteReadyOnly: true })}`)).toBeUndefined();
    expect(snapshotCache.values.get(`markets:${stableQueryCacheKey({ limit: 80, quoteReadyOnly: true, view: "compact" })}`)).toBeUndefined();
  });

  it("does not run materialization after stop is requested", async () => {
    const listMarkets = vi.fn(async () => [baseMarket]);
    const listLatestMarketQuoteReadiness = vi.fn(async () => []);
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness
      },
      snapshotCache: new FakeSnapshotCache(),
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: [], intervalMs: 60_000 }
    });

    await materializer.stop();
    const result = await materializer.runOnce();

    expect(result).toEqual({ attempted: 0, written: 0, skippedEmptyQuoteReady: 0, skippedUnderfilledQuoteReady: 0, failed: 0 });
    expect(listMarkets).not.toHaveBeenCalled();
    expect(listLatestMarketQuoteReadiness).not.toHaveBeenCalled();
  });

  it("prebuilds category-specific market snapshots for common frontend filters", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const listMarkets = vi.fn(async () => [baseMarket]);
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [{
          canonicalMarketId: "market-1",
          quoteStatus: "live" as const,
          quoteReadyVenueCount: 2,
          quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
          quoteBlockers: [],
          lastQuoteAt: "2026-06-01T00:00:00.000Z"
        }])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: ["Crypto"], intervalMs: 60_000 }
    });

    const result = await materializer.runOnce();

    expect(result).toMatchObject({ attempted: 10, written: 20, failed: 0 });
    expect(listMarkets).toHaveBeenCalledWith({ limit: 80 });
    expect(listMarkets).toHaveBeenCalledWith({ limit: 80, category: "Crypto" });
    const categoryKey = `markets:${stableQueryCacheKey({
      category: "Crypto",
      limit: 80,
      quoteReadyOnly: true,
      routeCoverage: "all",
      view: "compact"
    })}`;
    expect(snapshotCache.values.get(categoryKey)).toMatchObject({
      count: 1,
      materialized: true,
      view: "compact",
      markets: [{ quoteReadyVenueCount: 2, quoteReadyVenues: ["LIMITLESS", "POLYMARKET"] }]
    });
  });

  it("merges category quote-ready snapshots into the global quote-ready snapshot", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const sportsMarket: MarketCatalogMarket = {
      ...baseMarket,
      canonicalEventId: "event-sports",
      canonicalMarketIds: ["market-sports"],
      title: "Sports Market",
      category: "SPORTS"
    };
    const listMarkets = vi.fn(async (filter?: { category?: string }) =>
      filter?.category === "Sports" ? [sportsMarket] : [baseMarket]
    );
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [
          {
            canonicalMarketId: "market-1",
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 2,
            quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
            quoteBlockers: [],
            lastQuoteAt: "2026-06-01T00:00:00.000Z"
          },
          {
            canonicalMarketId: "market-sports",
            quoteStatus: "stale" as const,
            quoteReadyVenueCount: 2,
            quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
            quoteBlockers: [],
            lastQuoteAt: "2026-06-01T00:00:00.000Z"
          }
        ])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: ["Sports"], intervalMs: 60_000 }
    });

    await materializer.runOnce();

    const globalKey = `markets:${stableQueryCacheKey({ limit: 80, quoteReadyOnly: true })}`;
    expect(snapshotCache.values.get(globalKey)).toMatchObject({
      count: 2,
      markets: [
        { canonicalMarketIds: ["market-1"] },
        { canonicalMarketIds: ["market-sports"] }
      ]
    });
    expect(listMarkets).toHaveBeenCalledWith({ limit: 80, category: "Sports" });
    expect(listMarkets).toHaveBeenCalledWith({ limit: 80 });
  });

  it("recovers empty category quote-ready materialization from the global snapshot", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const sportsMarket: MarketCatalogMarket = {
      ...baseMarket,
      canonicalEventId: "event-sports",
      canonicalMarketIds: ["market-sports"],
      title: "Sports Market",
      category: "SPORTS",
      quoteStatus: "stale",
      quoteReadyVenueCount: 2,
      quoteReadyVenues: ["LIMITLESS", "POLYMARKET"]
    };
    await snapshotCache.set(`markets:${stableQueryCacheKey({ limit: 80, quoteReadyOnly: true })}`, {
      count: 1,
      materialized: true,
      markets: [sportsMarket]
    });
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets: vi.fn(async () => [])
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: ["Sports"], intervalMs: 60_000 }
    });

    const result = await materializer.runOnce();

    expect(result.skippedEmptyQuoteReady).toBeGreaterThan(0);
    expect(snapshotCache.values.get(`markets:${stableQueryCacheKey({ category: "Sports", limit: 80, quoteReadyOnly: true })}`)).toMatchObject({
      count: 1,
      markets: [{ canonicalMarketIds: ["market-sports"], category: "SPORTS" }]
    });
  });

  it("does not overwrite larger quote-ready snapshots with transient underfilled materialization", async () => {
    const snapshotCache = new FakeSnapshotCache();
    const key = `markets:${stableQueryCacheKey({
      category: "Crypto",
      limit: 80,
      quoteReadyOnly: true
    })}`;
    await snapshotCache.set(key, {
      count: 2,
      materialized: true,
      markets: [
        baseMarket,
        { ...baseMarket, canonicalMarketIds: ["market-2"], canonicalEventId: "event-2", title: "Event 2" }
      ]
    });
    const materializer = new MarketCatalogSnapshotMaterializer({
      marketCatalogRepository: {
        listMarkets: vi.fn(async () => [baseMarket])
      },
      marketQuoteReadinessSource: {
        listLatestMarketQuoteReadiness: vi.fn(async () => [{
          canonicalMarketId: "market-1",
          quoteStatus: "live" as const,
          quoteReadyVenueCount: 2,
          quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
          quoteBlockers: [],
          lastQuoteAt: "2026-06-01T00:00:00.000Z"
        }])
      },
      snapshotCache,
      logger: { info: vi.fn(), warn: vi.fn() },
      config: { limits: [80], routeCoverages: ["all"], categories: ["Crypto"], intervalMs: 60_000 }
    });

    const result = await materializer.runOnce();

    expect(result.skippedUnderfilledQuoteReady).toBe(1);
    expect(snapshotCache.values.get(key)).toMatchObject({
      count: 2,
      markets: [
        { canonicalMarketIds: ["market-1"] },
        { canonicalMarketIds: ["market-2"] }
      ]
    });
    const compactKey = `markets:${stableQueryCacheKey({
      category: "Crypto",
      limit: 80,
      quoteReadyOnly: true,
      view: "compact"
    })}`;
    expect(snapshotCache.values.get(compactKey)).toMatchObject({
      count: 2,
      materialized: true,
      view: "compact",
      markets: [
        { canonicalMarketIds: ["market-1"] },
        { canonicalMarketIds: ["market-2"] }
      ]
    });
    expect(JSON.stringify(snapshotCache.values.get(compactKey))).not.toContain("venueMarkets");
  });
});
