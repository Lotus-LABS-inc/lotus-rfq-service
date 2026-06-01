import { describe, expect, it, vi } from "vitest";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../src/repositories/market-catalog.repository.js";
import type { MarketCatalogSnapshotCache } from "../src/services/market-catalog-snapshot-cache.js";
import {
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
      config: { limits: [80], routeCoverages: ["all", "pair"], intervalMs: 60_000 }
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
      config: { limits: [80], routeCoverages: ["all"], intervalMs: 60_000 }
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
});
