import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMarketQuoteReadinessCacheForTests, registerMarketCatalogRoutes } from "../src/api/routes/markets.js";
import type {
  MarketCatalogCategory,
  MarketCatalogEvent,
  MarketCatalogMarket,
  MarketCatalogRepository
} from "../src/repositories/market-catalog.repository.js";
import {
  MarketCatalogRepository as PgMarketCatalogRepository,
  SharedCoreQuoteMappingRepository
} from "../src/repositories/market-catalog.repository.js";
import type { MarketCatalogSnapshotCache } from "../src/services/market-catalog-snapshot-cache.js";
import { marketCatalogDetailCacheKey } from "../src/services/market-catalog-snapshot-materializer.js";
import { marketOrderbookTopic } from "../src/services/orderbook-stream.service.js";

const market: MarketCatalogMarket = {
  eventId: "event:NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  eventTitle: "Republican Presidential Nominee 2028",
  canonicalEventId: "11111111-1111-5111-8111-111111111111",
  canonicalMarketIds: ["NOMINEE|US_PRESIDENT|2028|REPUBLICAN"],
  displayTopic: "Republican Presidential Nominee 2028",
  displayOutcome: "JD Vance",
  displayOutcomeKey: "candidate:JD_VANCE",
  title: "Republican Presidential Nominee 2028",
  normalizedTitle: "2028 republican presidential nomination",
  category: "POLITICS",
  marketClass: "CATEGORICAL",
  status: "OPEN",
  startsAt: null,
  expiresAt: "2028-11-01T00:00:00.000Z",
  resolvesAt: null,
  venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
  venueCount: 3,
  venueMarketCount: 3,
  outcomeCount: 2,
  routeability: {
    hasSingleVenue: true,
    hasCrossVenue: true
  },
  imageUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/republican-nominee.png",
  iconUrl: null,
  volume: "1200000",
  volume24h: "250000",
  liquidity: "500000",
  buyVolume: "125000",
  sellVolume: "95000",
  tradeCount: "1100",
  buyCount: "650",
  sellCount: "450",
  venueMarkets: [{
    canonicalMarketId: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    canonicalMarketTitle: "Republican Presidential Nominee 2028",
    venue: "POLYMARKET",
    venueMarketProfileId: "vmp_poly",
    venueMarketId: "poly-1",
    marketSlug: "republican-presidential-nominee-2028",
    eventSlug: "republican-presidential-nominee-2028",
    sourceUrl: "https://polymarket.com/event/republican-presidential-nominee-2028",
    venueTitle: "Republican nominee?",
    imageUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/republican-nominee.png",
    iconUrl: null,
    volume: "1200000",
    volume24h: "250000",
    liquidity: "500000",
    buyVolume: "125000",
    sellVolume: "95000",
    tradeCount: "1100",
    buyCount: "650",
    sellCount: "450",
    change24h: "0.02",
    changePercent24h: "1.5",
    marketClass: "CATEGORICAL",
    outcomes: [{ id: "jd-vance", label: "JD Vance" }, { id: "donald-trump", label: "Donald Trump" }],
    resolutionSource: "Polymarket market rules",
    resolutionTitle: "Republican nominee?",
    resolutionRulesText: "This market resolves to the Republican nominee for the 2028 US presidential election.",
    network: "POLYGON",
    chain: "POLYGON",
    expiresAt: "2028-11-01T00:00:00.000Z",
    resolvesAt: null
  }],
  updatedAt: "2026-05-03T00:00:00.000Z"
};

const marketEvent: MarketCatalogEvent = {
  eventId: "event:NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  title: "Republican Presidential Nominee 2028",
  normalizedTitle: "2028 republican presidential nomination",
  category: "POLITICS",
  status: "OPEN",
  marketCount: 1,
  featuredMarkets: [market],
  markets: [market],
  venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
  venueCount: 3,
  venueMarketCount: 3,
  outcomeCount: 2,
  routeability: {
    hasSingleVenue: true,
    hasCrossVenue: true
  },
  imageUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/republican-nominee.png",
  iconUrl: null,
  volume: "1200000",
  volume24h: "250000",
  liquidity: "500000",
  buyVolume: "125000",
  sellVolume: "95000",
  tradeCount: "1100",
  buyCount: "650",
  sellCount: "450",
  updatedAt: "2026-05-03T00:00:00.000Z"
};

class FakeMarketCatalogRepository implements Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "listEvents" | "getMarket" | "getEvent"> {
  public filters: unknown[] = [];
  public getMarketCalls: string[] = [];

  public async listCategories(): Promise<MarketCatalogCategory[]> {
    return [{ category: "POLITICS", marketCount: 1, eventCount: 1 }];
  }

  public async listMarkets(filter = {}): Promise<MarketCatalogMarket[]> {
    this.filters.push(filter);
    return [market];
  }

  public async getMarket(marketId: string): Promise<MarketCatalogMarket | null> {
    this.getMarketCalls.push(marketId);
    return marketId === market.canonicalEventId || marketId === market.canonicalMarketIds[0] ? market : null;
  }

  public async listEvents(filter = {}): Promise<MarketCatalogEvent[]> {
    this.filters.push(filter);
    return [marketEvent];
  }

  public async getEvent(eventId: string): Promise<MarketCatalogEvent | null> {
    return eventId === marketEvent.eventId ? marketEvent : null;
  }
}

class FakeMarketCatalogSnapshotCache implements MarketCatalogSnapshotCache {
  public readonly values = new Map<string, unknown>();
  public getCount = 0;
  public setCount = 0;

  public async get<T>(key: string): Promise<T | null> {
    this.getCount += 1;
    return (this.values.get(key) as T | undefined) ?? null;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.setCount += 1;
    this.values.set(key, value);
  }
}

describe("market catalog routes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-21T23:41:16.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MARKET_QUOTE_READINESS_TIMEOUT_MS;
    delete process.env.MARKET_QUOTE_READINESS_STALE_CACHE_MS;
    delete process.env.MARKET_LIST_OVERFETCH_MULTIPLIER;
    delete process.env.MARKET_LIST_OVERFETCH_CAP;
    delete process.env.MARKET_CATALOG_RESPONSE_CACHE_MS;
    delete process.env.MARKET_CATALOG_RESPONSE_STALE_CACHE_MS;
    delete process.env.MARKET_DETAIL_CACHE_MS;
    clearMarketQuoteReadinessCacheForTests();
  });

  it("lists normalized user-facing markets by category without raw venue internals", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: repository });

    const response = await app.inject({
      method: "GET",
      url: "/markets?category=politics&search=nominee&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 1,
      markets: [{
        title: "Republican Presidential Nominee 2028",
        category: "POLITICS",
        venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
        imageUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/republican-nominee.png",
        iconUrl: null,
        routeability: { hasCrossVenue: true }
      }]
    });
    expect(repository.filters[0]).toMatchObject({ category: "politics", search: "nominee", limit: 10 });
    expect(response.body).not.toContain("raw_source_payload");
    expect(response.body).not.toContain("apiKey");
    expect(response.body).not.toContain("privateKey");

    await app.close();
  });

  it("serves compact market lists without heavy venue detail payloads", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: repository });

    const response = await app.inject({
      method: "GET",
      url: "/markets?limit=10&view=compact"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 1,
      view: "compact",
      markets: [{
        canonicalEventId: market.canonicalEventId,
        title: "Republican Presidential Nominee 2028",
        category: "POLITICS",
        venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
        venueCount: 3,
        routeability: { hasCrossVenue: true }
      }]
    });
    expect(response.json().markets[0]).not.toHaveProperty("venueMarkets");
    expect(response.body).not.toContain("resolutionRulesText");

    await app.close();
  });

  it("marks listed markets active for the orderbook stream service", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    const touch = vi.fn();
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketActivityTracker: { touch }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?limit=10&view=compact"
    });

    expect(response.statusCode).toBe(200);
    expect(touch).toHaveBeenCalledWith({ canonicalMarketId: market.canonicalMarketIds[0] });

    await app.close();
  });

  it("prewarms terminal orderbooks for visible quote-ready markets", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    const getOrderbook = vi.fn(async (input: {
      marketId: string;
      canonicalMarketIds?: readonly string[] | undefined;
      outcomeId?: string | undefined;
    }) => ({
      marketId: input.marketId,
      outcomeId: input.outcomeId ?? null,
      generatedAt: new Date().toISOString(),
      depth: 20,
      venues: [],
      bids: [],
      asks: [],
      bestBid: null,
      bestAsk: null,
      midpoint: null,
      spread: null,
      status: "unavailable" as const,
      blockers: []
    }));
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "partial" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      },
      marketDataViewService: {
        getOrderbook,
        getChart: vi.fn()
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10&view=compact"
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(response.statusCode).toBe(200);
    expect(getOrderbook).toHaveBeenCalledTimes(2);
    expect(getOrderbook).toHaveBeenCalledWith({
      marketId: market.canonicalEventId,
      canonicalMarketIds: market.canonicalMarketIds,
      outcomeId: "YES"
    });
    expect(getOrderbook).toHaveBeenCalledWith({
      marketId: market.canonicalEventId,
      canonicalMarketIds: market.canonicalMarketIds,
      outcomeId: "NO"
    });

    await app.close();
  });

  it("filters quote-ready markets and returns sanitized readiness fields", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "partial" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: [{
              venue: "LIMITLESS",
              reason: "QUOTE_PROVIDER_HTTP_429",
              venueMarketId: "limitless-1"
            }]
          }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 1,
      markets: [{
        quoteStatus: "partial",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["POLYMARKET"],
        lastQuoteAt: "2026-05-21T23:41:15.000Z",
        quoteBlockers: [{
          venue: "LIMITLESS",
          reason: "QUOTE_PROVIDER_HTTP_429",
          venueMarketId: "limitless-1"
        }]
      }]
    });
    expect(response.body).not.toContain("apiKey");
    expect(response.body).not.toContain("privateKey");

    await app.close();
  });

  it("hides markets with no quote-ready venue only when requested", async () => {
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: new FakeMarketCatalogRepository(),
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "unavailable" as const,
            quoteReadyVenueCount: 0,
            quoteReadyVenues: [],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: [{
              venue: "POLYMARKET",
              reason: "closed_or_not_accepting_orders",
              venueMarketId: "poly-closed"
            }]
          }];
        }
      }
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });
    const unfiltered = await app.inject({
      method: "GET",
      url: "/markets?limit=10"
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ count: 0, markets: [] });
    expect(unfiltered.statusCode).toBe(200);
    expect(unfiltered.json()).toMatchObject({
      count: 1,
      markets: [{ quoteStatus: "unavailable", quoteReadyVenueCount: 0 }]
    });

    await app.close();
  });

  it("does not return unfiltered unavailable markets when quote readiness snapshots time out", async () => {
    process.env.MARKET_QUOTE_READINESS_TIMEOUT_MS = "1";
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: new FakeMarketCatalogRepository(),
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return new Promise(() => undefined);
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&routeCoverage=all&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 0,
      quoteReadinessDegraded: true,
      quoteReadinessReason: "timeout",
      markets: []
    });

    await app.close();
  });

  it("does not count stale last-good quote readiness as quote-ready when a later snapshot read times out", async () => {
    process.env.MARKET_QUOTE_READINESS_TIMEOUT_MS = "1";
    const app = Fastify({ logger: false });
    let shouldTimeout = false;
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: new FakeMarketCatalogRepository(),
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          if (shouldTimeout) {
            return new Promise(() => undefined);
          }
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const warm = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&routeCoverage=all&limit=10"
    });
    shouldTimeout = true;
    const degraded = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&routeCoverage=all&limit=11"
    });

    expect(warm.statusCode).toBe(200);
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json()).toMatchObject({
      count: 0,
      quoteReadinessDegraded: true,
      quoteReadinessReason: "timeout",
      markets: []
    });

    await app.close();
  });

  it("materializes all-market catalog responses into the shared snapshot cache", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache
    });

    const first = await app.inject({
      method: "GET",
      url: "/markets?limit=10"
    });
    clearMarketQuoteReadinessCacheForTests();
    const second = await app.inject({
      method: "GET",
      url: "/markets?limit=10"
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(snapshotCache.setCount).toBe(2);
    expect(repository.filters).toHaveLength(1);
    expect(snapshotCache.values.get("markets:{\"limit\":10,\"routeCoverage\":\"all\"}")).toMatchObject({
      count: 1,
      markets: [{ canonicalEventId: market.canonicalEventId }]
    });
    expect(second.json()).toMatchObject({
      count: 1,
      markets: [{ canonicalEventId: market.canonicalEventId }]
    });

    await app.close();
  });

  it("serves market details from the shared snapshot cache without hitting the repository", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    snapshotCache.values.set(marketCatalogDetailCacheKey(`${market.canonicalMarketIds[0]}:POLYMARKET`), {
      market,
      materialized: true,
      materializedAt: "2026-06-02T00:00:00.000Z"
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache
    });

    const response = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(`${market.canonicalMarketIds[0]}:POLYMARKET`)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      market: {
        canonicalEventId: market.canonicalEventId,
        canonicalMarketIds: market.canonicalMarketIds,
        title: market.title
      }
    });
    expect(repository.getMarketCalls).toHaveLength(0);

    await app.close();
  });

  it("writes market detail snapshots after repository detail lookup", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache
    });

    const response = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(market.canonicalMarketIds[0]!)}`
    });

    expect(response.statusCode).toBe(200);
    expect(repository.getMarketCalls).toEqual([market.canonicalMarketIds[0]]);
    expect(snapshotCache.values.get(marketCatalogDetailCacheKey(market.canonicalMarketIds[0]!))).toMatchObject({
      materialized: true,
      market: { canonicalEventId: market.canonicalEventId }
    });
    expect(snapshotCache.values.get(marketCatalogDetailCacheKey(`${market.canonicalMarketIds[0]}:POLYMARKET`))).toMatchObject({
      materialized: true,
      market: { canonicalEventId: market.canonicalEventId }
    });

    await app.close();
  });

  it("serves smaller quote-ready market lists from larger shared snapshots", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const liveMarket = {
      ...market,
      quoteStatus: "live" as const,
      quoteReadyVenueCount: 1,
      quoteReadyVenues: ["POLYMARKET"],
      lastQuoteAt: "2026-05-21T23:41:15.000Z"
    };
    snapshotCache.values.set("markets:{\"limit\":80,\"quoteReadyOnly\":true}", {
      markets: [liveMarket, { ...liveMarket, canonicalEventId: "22222222-2222-5222-8222-222222222222", eventId: "event:two" }],
      count: 2,
      materialized: true
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          throw new Error("readiness should not be called when shared snapshot fallback is available");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=1"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(0);
    expect(snapshotCache.getCount).toBeGreaterThanOrEqual(2);
    expect(response.json()).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{ canonicalEventId: market.canonicalEventId }]
    });

    await app.close();
  });

  it("uses routeCoverage=all snapshots as quote-ready aliases when the frontend omits routeCoverage", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const liveMarket = {
      ...market,
      quoteStatus: "live" as const,
      quoteReadyVenueCount: 1,
      quoteReadyVenues: ["POLYMARKET"],
      lastQuoteAt: "2026-05-21T23:41:15.000Z"
    };
    const secondLiveMarket = {
      ...liveMarket,
      canonicalEventId: "22222222-2222-5222-8222-222222222222",
      eventId: "event:two",
      canonicalMarketIds: ["market-two"]
    };
    snapshotCache.values.set("markets:{\"limit\":10,\"quoteReadyOnly\":true}", {
      markets: [liveMarket],
      count: 1,
      materialized: true
    });
    snapshotCache.values.set("markets:{\"limit\":10,\"quoteReadyOnly\":true,\"routeCoverage\":\"all\"}", {
      markets: [liveMarket, secondLiveMarket],
      count: 2,
      materialized: true
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          throw new Error("readiness should not be called when shared snapshot alias is available");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(0);
    expect(response.json()).toMatchObject({
      count: 2,
      materialized: true,
      markets: [
        { canonicalEventId: market.canonicalEventId },
        { canonicalEventId: secondLiveMarket.canonicalEventId }
      ]
    });

    await app.close();
  });

  it("prefers fresh shared quote-ready snapshots over local in-memory catalog cache", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const first = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });
    const sharedMarket = {
      ...market,
      canonicalEventId: "22222222-2222-5222-8222-222222222222",
      eventId: "event:shared",
      quoteStatus: "partial" as const,
      quoteReadyVenueCount: 2,
      quoteReadyVenues: ["LIMITLESS", "POLYMARKET"],
      lastQuoteAt: "2026-05-21T23:41:15.000Z"
    };
    snapshotCache.values.set("markets:{\"limit\":10,\"quoteReadyOnly\":true}", {
      markets: [sharedMarket],
      count: 1,
      materialized: true
    });
    repository.filters = [];

    const second = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(0);
    expect(second.json()).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{
        canonicalEventId: sharedMarket.canonicalEventId,
        quoteReadyVenueCount: 2
      }]
    });

    await app.close();
  });

  it("rebuilds stale quote-ready shared snapshots from hot readiness on the user request", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    snapshotCache.values.set("markets:{\"limit\":10,\"quoteReadyOnly\":true}", {
      markets: [{
        ...market,
        quoteStatus: "live" as const,
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["POLYMARKET"],
        lastQuoteAt: "2026-05-21T23:40:00.000Z"
      }],
      count: 1,
      materialized: true
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["LIMITLESS"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(1);
    expect(response.json()).toMatchObject({
      count: 1,
      markets: [{
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["LIMITLESS"]
      }]
    });

    await app.close();
  });

  it("serves smaller all-market catalog lists from larger shared snapshots", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    snapshotCache.values.set("markets:{\"limit\":80}", {
      markets: [market, { ...market, canonicalEventId: "33333333-3333-5333-8333-333333333333", eventId: "event:three" }],
      count: 2,
      materialized: true
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          throw new Error("readiness should not be called when all-market shared snapshot fallback is available");
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?limit=1"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(0);
    expect(snapshotCache.getCount).toBeGreaterThanOrEqual(2);
    expect(response.json()).toMatchObject({
      count: 1,
      materialized: true,
      markets: [{ canonicalEventId: market.canonicalEventId }]
    });

    await app.close();
  });

  it("rebuilds empty quote-ready shared snapshots from hot readiness on the user request", async () => {
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    snapshotCache.values.set("markets:{\"limit\":10,\"quoteReadyOnly\":true}", {
      markets: [],
      count: 0
    });
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["OPINION"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters).toHaveLength(1);
    expect(response.json()).toMatchObject({
      count: 1,
      markets: [{
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["OPINION"]
      }]
    });

    await app.close();
  });

  it("does not materialize empty quote-ready responses when the hot snapshot is missing", async () => {
    process.env.MARKET_QUOTE_READINESS_TIMEOUT_MS = "1";
    const repository = new FakeMarketCatalogRepository();
    const snapshotCache = new FakeMarketCatalogSnapshotCache();
    const app = Fastify({ logger: false });
    let shouldTimeout = false;
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketCatalogSnapshotCache: snapshotCache,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          if (shouldTimeout) {
            return new Promise(() => undefined);
          }
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const warm = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=10"
    });
    shouldTimeout = true;
    const degraded = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=11"
    });

    expect(warm.statusCode).toBe(200);
    expect(degraded.statusCode).toBe(200);
    expect(snapshotCache.setCount).toBe(2);
    expect(repository.filters).toHaveLength(2);
    expect(snapshotCache.values.get("markets:{\"limit\":10,\"quoteReadyOnly\":true,\"routeCoverage\":\"all\"}")).toMatchObject({
      count: 1,
      markets: [{ quoteReadyVenueCount: 1 }]
    });
    expect(warm.json()).toMatchObject({
      count: 1,
      markets: [{ quoteReadyVenueCount: 1 }]
    });
    expect(degraded.json()).toMatchObject({
      markets: []
    });

    await app.close();
  });

  it("fetches a larger catalog window before quote-ready filtering", async () => {
    const readyMarket = {
      ...market,
      canonicalEventId: "44444444-4444-5444-8444-444444444444",
      canonicalMarketIds: ["READY_LATE_MARKET"]
    };
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    repository.listMarkets = async (filter = {}) => {
      repository.filters.push(filter);
      const rows = Array.from({ length: 24 }, (_, index) => ({
        ...market,
        canonicalEventId: `55555555-5555-5555-8555-${String(index).padStart(12, "0")}`,
        canonicalMarketIds: [`UNREADY_${index}`]
      }));
      rows.push(readyMarket);
      return rows;
    };
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: "READY_LATE_MARKET",
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&limit=24"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters[0]).toMatchObject({ limit: 250 });
    expect(response.json().markets.map((item: MarketCatalogMarket) => item.canonicalMarketIds[0])).toEqual(["READY_LATE_MARKET"]);

    await app.close();
  });

  it("uses a code-owned 1000 row cap for large quote-ready catalog windows", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    repository.listMarkets = async (filter = {}) => {
      repository.filters.push(filter);
      return [market];
    };
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/markets?quoteReadyOnly=true&routeCoverage=tri&limit=250"
    });

    expect(response.statusCode).toBe(200);
    expect(repository.filters[0]).toMatchObject({ limit: 1000 });

    await app.close();
  });

  it("filters quote-ready markets by pair tri and strict-all coverage", async () => {
    const pairMarket = {
      ...market,
      canonicalEventId: "22222222-2222-5222-8222-222222222222",
      canonicalMarketIds: ["PAIR_MARKET"],
      venues: ["POLYMARKET", "LIMITLESS"],
      venueCount: 2,
      venueMarketCount: 2
    };
    const triMarket = {
      ...market,
      canonicalEventId: "33333333-3333-5333-8333-333333333333",
      canonicalMarketIds: ["TRI_MARKET"],
      venues: ["POLYMARKET", "LIMITLESS", "PREDICT_FUN"],
      venueCount: 3,
      venueMarketCount: 3
    };
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    repository.listMarkets = async () => [market, pairMarket, triMarket];
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: repository,
      marketQuoteReadinessSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: market.canonicalMarketIds[0]!,
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            lastQuoteAt: "2026-05-21T23:41:15.000Z",
            quoteBlockers: []
          }, {
            canonicalMarketId: "PAIR_MARKET",
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 2,
            quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
            lastQuoteAt: "2026-05-21T23:41:16.000Z",
            quoteBlockers: []
          }, {
            canonicalMarketId: "TRI_MARKET",
            quoteStatus: "partial" as const,
            quoteReadyVenueCount: 2,
            quoteReadyVenues: ["POLYMARKET", "LIMITLESS"],
            lastQuoteAt: "2026-05-21T23:41:17.000Z",
            quoteBlockers: [{
              venue: "PREDICT_FUN",
              reason: "PREDICT_PROVIDER_AUTH_INVALID"
            }]
          }];
        }
      }
    });

    const pair = await app.inject({ method: "GET", url: "/markets?quoteReadyOnly=true&routeCoverage=pair&limit=10" });
    const tri = await app.inject({ method: "GET", url: "/markets?quoteReadyOnly=true&routeCoverage=tri&limit=10" });
    const strictAll = await app.inject({ method: "GET", url: "/markets?quoteReadyOnly=true&routeCoverage=strict_all&limit=10" });

    expect(pair.statusCode).toBe(200);
    expect(pair.json().markets.map((item: MarketCatalogMarket) => item.canonicalMarketIds[0])).toEqual(["PAIR_MARKET", "TRI_MARKET"]);
    expect(tri.statusCode).toBe(200);
    expect(tri.json()).toMatchObject({ count: 0, markets: [] });
    expect(strictAll.statusCode).toBe(200);
    expect(strictAll.json().markets.map((item: MarketCatalogMarket) => item.canonicalMarketIds[0])).toEqual(["PAIR_MARKET"]);

    await app.close();
  });

  it("lists event-first market catalog while preserving child outcome markets", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: repository });

    const response = await app.inject({
      method: "GET",
      url: "/events?category=politics&search=nominee&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 1,
      events: [{
        title: "Republican Presidential Nominee 2028",
        category: "POLITICS",
        marketCount: 1,
        markets: [{
          title: "Republican Presidential Nominee 2028"
        }]
      }]
    });

    const eventMarkets = await app.inject({
      method: "GET",
      url: `/events/${encodeURIComponent(marketEvent.eventId)}/markets`
    });
    expect(eventMarkets.statusCode).toBe(200);
    expect(eventMarkets.json().markets).toHaveLength(1);

    await app.close();
  });

  it("returns detail and normalized outcomes for a canonical market", async () => {
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: new FakeMarketCatalogRepository() });

    const detail = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(market.canonicalMarketIds[0]!)}`
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().market.title).toBe("Republican Presidential Nominee 2028");
    expect(detail.json().market.venueMarkets[0].imageUrl).toBe("https://polymarket-upload.s3.us-east-2.amazonaws.com/republican-nominee.png");
    expect(detail.json().market.venueMarkets[0].sourceUrl).toBe("https://polymarket.com/event/republican-presidential-nominee-2028");
    expect(detail.json().market.venueMarkets[0].marketSlug).toBe("republican-presidential-nominee-2028");
    expect(detail.json().market.venueMarkets[0].resolutionRulesText).toContain("Republican nominee");

    const suffixedDetail = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(`${market.canonicalMarketIds[0]!}:POLYMARKET`)}`
    });
    expect(suffixedDetail.statusCode).toBe(200);
    expect(suffixedDetail.json().market.title).toBe("Republican Presidential Nominee 2028");

    const outcomes = await app.inject({
      method: "GET",
      url: `/markets/${market.canonicalEventId}/outcomes`
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json().outcomes.map((entry: { label: string }) => entry.label)).toEqual(["Donald Trump", "JD Vance"]);

    const suffixedOutcomes = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(`${market.canonicalMarketIds[0]!}:POLYMARKET`)}/outcomes`
    });
    expect(suffixedOutcomes.statusCode).toBe(200);
    expect(suffixedOutcomes.json().outcomes.map((entry: { label: string }) => entry.label)).toEqual(["Donald Trump", "JD Vance"]);

    const missing = await app.inject({ method: "GET", url: "/markets/missing" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("returns sanitized live orderbook and chart contracts", async () => {
    const app = Fastify({ logger: false });
    const touchedActivity: Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined }> = [];
    const orderbookRequests: Array<{
      marketId: string;
      canonicalMarketIds?: readonly string[] | undefined;
      outcomeId?: string | undefined;
      depth?: number | undefined;
    }> = [];
    const aggregateCanonicalMarketIds = [
      market.canonicalMarketIds[0]!,
      "NOMINEE|US_PRESIDENT|2028|REPUBLICAN:LIMITLESS"
    ];
    const aggregateRepository = new FakeMarketCatalogRepository();
    vi.spyOn(aggregateRepository, "getMarket").mockImplementation(async (marketId) => (
      marketId === market.canonicalEventId || aggregateCanonicalMarketIds.includes(marketId)
        ? { ...market, canonicalMarketIds: aggregateCanonicalMarketIds }
        : null
    ));
    await registerMarketCatalogRoutes(app, {
      marketCatalogRepository: aggregateRepository,
      marketActivityTracker: {
        touch: (input) => {
          touchedActivity.push(input);
        }
      },
      marketDataViewService: {
        getOrderbook: async (input) => {
          orderbookRequests.push(input);
          return {
            marketId: input.marketId,
            outcomeId: input.outcomeId ?? null,
            generatedAt: "2026-05-10T00:00:00.000Z",
            depth: input.depth ?? 20,
            status: "live" as const,
            bestBid: "0.51",
            bestAsk: "0.53",
            midpoint: "0.52",
            spread: "0.02",
            blockers: [],
            venues: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              source: "REST" as const,
              quoteQuality: "FULL_DEPTH_REST",
              sourceTimestamp: null,
              receivedAt: "2026-05-10T00:00:00.000Z",
              bestBid: "0.51",
              bestAsk: "0.53",
              midpoint: "0.52",
              spread: "0.02",
              bidDepth: "100",
              askDepth: "90",
              blockers: [],
              bids: [{
                venue: "POLYMARKET",
                venueMarketId: "poly-1",
                venueOutcomeId: "yes",
                price: "0.51",
                size: "100",
                cumulativeSize: "100",
                cumulativeNotional: "51"
              }],
              asks: [{
                venue: "POLYMARKET",
                venueMarketId: "poly-1",
                venueOutcomeId: "yes",
                price: "0.53",
                size: "90",
                cumulativeSize: "90",
                cumulativeNotional: "47.7"
              }]
            }],
            bids: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              price: "0.51",
              size: "100",
              cumulativeSize: "100",
              cumulativeNotional: "51"
            }],
            asks: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              price: "0.53",
              size: "90",
              cumulativeSize: "90",
              cumulativeNotional: "47.7"
            }]
          };
        },
        getChart: async (input) => ({
          marketId: input.marketId,
          outcomeId: input.outcomeId ?? null,
          timeframe: input.timeframe,
          generatedAt: "2026-05-10T00:00:00.000Z",
          historyStatus: "accumulating" as const,
          blockers: [],
          series: [{ id: "unified", label: "Unified", color: "#ccff00" }],
          points: [{
            timestamp: "2026-05-10T00:00:00.000Z",
            label: "12:00 AM",
            unified: "0.52",
            venues: { POLYMARKET: "0.52" }
          }]
        }),
        getBatchQuotes: async (input) => ({
          generatedAt: "2026-05-10T00:00:00.000Z",
          quotes: input.items.map((item) => ({
            marketId: item.marketId,
            outcomeId: item.outcomeId,
            side: item.side ?? "buy",
            generatedAt: "2026-05-10T00:00:00.000Z",
            status: "live" as const,
            bestVenue: "POLYMARKET",
            bestVenuePrice: "0.53",
            unifiedAveragePrice: "0.53",
            liquidity: "47.7",
            spread: "0.02",
            freshnessMs: 500,
            venues: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-1",
              venueOutcomeId: "yes",
              price: "0.53",
              bid: "0.51",
              ask: "0.53",
              availableSize: "90",
              liquidity: "47.7",
              spread: "0.02",
              source: "REST" as const,
              quoteQuality: "FULL_DEPTH_REST",
              freshnessMs: 500,
              blockers: []
            }],
            blockers: []
          }))
        })
      }
    });

    const orderbook = await app.inject({
      method: "GET",
      url: `/markets/${market.canonicalEventId}/orderbook?outcomeId=yes&depth=10`
    });
    expect(orderbook.statusCode).toBe(200);
    expect(orderbook.json()).toMatchObject({
      status: "live",
      bestBid: "0.51",
      asks: [{ venue: "POLYMARKET", price: "0.53" }],
      stream: {
        primaryTopic: marketOrderbookTopic(market.canonicalMarketIds[0]!, "yes"),
        topics: [
          marketOrderbookTopic(market.canonicalMarketIds[0]!, "yes"),
          marketOrderbookTopic("NOMINEE|US_PRESIDENT|2028|REPUBLICAN:LIMITLESS", "yes")
        ]
      }
    });
    expect(orderbook.body).not.toContain("apiKey");
    expect(orderbook.body).not.toContain("raw_source_payload");
    expect(orderbookRequests[0]).toMatchObject({
      marketId: market.canonicalEventId,
      canonicalMarketIds: aggregateCanonicalMarketIds,
      outcomeId: "yes",
      depth: 10
    });
    expect(touchedActivity).toContainEqual({
      canonicalMarketId: market.canonicalMarketIds[0],
      canonicalOutcomeId: "yes"
    });
    expect(touchedActivity).toContainEqual({
      canonicalMarketId: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN:LIMITLESS",
      canonicalOutcomeId: "yes"
    });

    const suffixedOrderbook = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(`${market.canonicalMarketIds[0]!}:LIMITLESS`)}/orderbook?outcomeId=yes&depth=10`
    });
    expect(suffixedOrderbook.statusCode).toBe(200);
    expect(suffixedOrderbook.json()).toMatchObject({
      status: "live",
      bestBid: "0.51"
    });
    expect(touchedActivity).toContainEqual({
      canonicalMarketId: market.canonicalMarketIds[0],
      canonicalOutcomeId: "yes"
    });

    const chart = await app.inject({
      method: "GET",
      url: `/markets/${market.canonicalEventId}/chart?outcomeId=yes&timeframe=1H`
    });
    expect(chart.statusCode).toBe(200);
    expect(chart.json()).toMatchObject({
      historyStatus: "accumulating",
      points: [{ unified: "0.52" }]
    });

    const suffixedChart = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(`${market.canonicalMarketIds[0]!}:POLYMARKET`)}/chart?outcomeId=yes&timeframe=1H`
    });
    expect(suffixedChart.statusCode).toBe(200);
    expect(suffixedChart.json()).toMatchObject({
      historyStatus: "accumulating",
      points: [{ unified: "0.52" }]
    });

    const batchQuotes = await app.inject({
      method: "POST",
      url: "/markets/quotes/batch",
      payload: {
        items: [{
          marketId: market.canonicalEventId,
          outcomeId: "yes",
          side: "buy",
          amount: "1"
        }]
      }
    });
    expect(batchQuotes.statusCode).toBe(200);
    expect(batchQuotes.json()).toMatchObject({
      quotes: [{
        marketId: market.canonicalEventId,
        outcomeId: "yes",
        bestVenue: "POLYMARKET",
        bestVenuePrice: "0.53",
        venues: [{ venue: "POLYMARKET", ask: "0.53" }]
      }]
    });
    expect(batchQuotes.body).not.toContain("apiKey");

    await app.close();
  });

  it("lists categories across available canonical markets", async () => {
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: new FakeMarketCatalogRepository() });

    const response = await app.inject({ method: "GET", url: "/markets/categories" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ categories: [{ category: "POLITICS", marketCount: 1, eventCount: 1 }] });

    await app.close();
  });

  it("treats epoch venue resolution timestamps as unset placeholders", async () => {
    const queries: unknown[] = [];
    const pool = {
      query: async (_sql: string, _params?: unknown[]) => {
        queries.push({ sql: _sql, params: _params });
        if (queries.length === 1) {
          return {
            rows: [{
              canonical_event_id: "11111111-1111-5111-8111-111111111112",
              proposition_key: "opinion-market-active",
              title: "Active Opinion Market",
              normalized_proposition_text: "active opinion market",
              canonical_category: "CRYPTO",
              market_class: "BINARY",
              starts_at: "2026-05-03T00:00:00.000Z",
              expires_at: "2028-05-10T00:00:00.000Z",
              resolves_at: "1970-01-01T00:00:00.000Z",
              updated_at: "2026-05-03T00:00:00.000Z",
              frontend_display_title: null,
              frontend_sort_priority: 1000,
              canonical_market_ids: ["opinion-market-active"],
              venues: ["OPINION"],
              venue_market_count: "1"
            }]
          };
        }
        return {
          rows: [{
            canonical_event_id: "11111111-1111-5111-8111-111111111112",
            canonical_market_id: "opinion-market-active",
            canonical_market_title: "Active Opinion Market",
            venue_market_profile_id: "vmp_opinion",
            venue: "OPINION",
            venue_market_id: "15525",
            venue_title: "Active Opinion Market",
            market_class: "BINARY",
            outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
            network: "BNB_MAINNET",
            chain: "BNB",
            expires_at: "2028-05-10T00:00:00.000Z",
            resolves_at: "1970-01-01T00:00:00.000Z"
          }]
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [activeMarket] = await repository.listMarkets({ limit: 1 });

    expect(activeMarket?.status).toBe("OPEN");
  });

  it("groups checked outcome markets under one user-facing event without dropping children", async () => {
    const queries: unknown[] = [];
    const pool = {
      query: async (_sql: string, _params?: unknown[]) => {
        queries.push({ sql: _sql, params: _params });
        if (queries.length === 1) {
          return {
            rows: [
              {
                canonical_event_id: "11111111-1111-5111-8111-111111111113",
                proposition_key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE",
                title: "Will JD Vance win the 2028 Republican presidential nomination?",
                normalized_proposition_text: "jd vance republican presidential nominee 2028",
                canonical_category: "POLITICS",
                market_class: "BINARY",
                starts_at: "2026-05-03T00:00:00.000Z",
                expires_at: "2028-11-01T00:00:00.000Z",
                resolves_at: null,
                updated_at: "2026-05-03T00:00:00.000Z",
                event_metadata: { curatedKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE" },
                frontend_display_title: "JD Vance",
                frontend_sort_priority: 10,
                canonical_market_ids: ["NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE"],
                venues: ["POLYMARKET"],
                venue_market_count: "1"
              },
              {
                canonical_event_id: "11111111-1111-5111-8111-111111111114",
                proposition_key: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|MARCO_RUBIO",
                title: "Will Marco Rubio win the 2028 Republican presidential nomination?",
                normalized_proposition_text: "marco rubio republican presidential nominee 2028",
                canonical_category: "POLITICS",
                market_class: "BINARY",
                starts_at: "2026-05-03T00:00:00.000Z",
                expires_at: "2028-11-01T00:00:00.000Z",
                resolves_at: null,
                updated_at: "2026-05-03T00:00:00.000Z",
                event_metadata: { curatedKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|MARCO_RUBIO" },
                frontend_display_title: "Marco Rubio",
                frontend_sort_priority: 11,
                canonical_market_ids: ["NOMINEE|US_PRESIDENT|2028|REPUBLICAN|MARCO_RUBIO"],
                venues: ["LIMITLESS"],
                venue_market_count: "1"
              }
            ]
          };
        }
        return {
          rows: [
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111113",
              canonical_market_id: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|JD_VANCE",
              canonical_market_title: "JD Vance",
              venue_market_profile_id: "vmp_poly_jd",
              venue: "POLYMARKET",
              venue_market_id: "poly-jd",
              venue_title: "JD Vance nominee",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
              network: "POLYGON",
              chain: "POLYGON",
              expires_at: "2028-11-01T00:00:00.000Z",
              resolves_at: null
            },
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111114",
              canonical_market_id: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN|MARCO_RUBIO",
              canonical_market_title: "Marco Rubio",
              venue_market_profile_id: "vmp_limitless_rubio",
              venue: "LIMITLESS",
              venue_market_id: "limitless-rubio",
              venue_title: "Marco Rubio nominee",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
              network: "BASE",
              chain: "BASE",
              expires_at: "2028-11-01T00:00:00.000Z",
              resolves_at: null
            }
          ]
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [event] = await repository.listEvents({ category: "POLITICS", limit: 10 });

    expect(event?.title).toBe("Republican Presidential Nominee 2028");
    expect(event?.marketCount).toBe(2);
    expect(event?.markets.map((child) => child.title)).toEqual(["JD Vance", "Marco Rubio"]);
    expect(event?.venues).toEqual(["LIMITLESS", "POLYMARKET"]);
  });

  it("requires explicit frontend approval for public market list queries", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    await repository.listMarkets({ limit: 5 });
    await repository.listCategories();

    expect(queries[0]).toContain("fma.status = 'APPROVED'");
    expect(queries[0]).toContain("fma.metadata->>'source' = 'frontend-curated-catalog'");
    expect(queries[1]).toContain("fma.status = 'APPROVED'");
    expect(queries[1]).toContain("fma.metadata->>'source' = 'frontend-curated-catalog'");
  });

  it("extracts only approved HTTPS media URLs from venue metadata", async () => {
    const queries: unknown[] = [];
    const pool = {
      query: async (_sql: string, _params?: unknown[]) => {
        queries.push({ sql: _sql, params: _params });
        if (queries.length === 1) {
          return {
            rows: [{
              canonical_event_id: "11111111-1111-5111-8111-111111111115",
              proposition_key: "POLY|MEDIA",
              title: "Polymarket Media Market",
              normalized_proposition_text: "polymarket media market",
              canonical_category: "SPORTS",
              market_class: "BINARY",
              starts_at: "2026-05-03T00:00:00.000Z",
              expires_at: "2028-05-10T00:00:00.000Z",
              resolves_at: null,
              updated_at: "2026-05-03T00:00:00.000Z",
              event_metadata: {},
              frontend_display_title: null,
              frontend_sort_priority: 1000,
              canonical_market_ids: ["POLY|MEDIA"],
              venues: ["POLYMARKET"],
              venue_market_count: "2"
            }]
          };
        }
        return {
          rows: [
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111115",
              canonical_market_id: "POLY|MEDIA",
              canonical_market_title: "Polymarket Media Market",
              venue_market_profile_id: "vmp_poly_media",
              venue: "POLYMARKET",
              venue_market_id: "poly-media",
              venue_title: "Polymarket Media Market",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }],
              network: "POLYGON",
              chain: "POLYGON",
              expires_at: "2028-05-10T00:00:00.000Z",
              resolves_at: null,
              normalized_payload: { image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/media.png#fragment" },
              raw_source_payload: { icon: "javascript:alert(1)" }
            },
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111115",
              canonical_market_id: "POLY|MEDIA",
              canonical_market_title: "Polymarket Media Market",
              venue_market_profile_id: "vmp_bad_media",
              venue: "POLYMARKET",
              venue_market_id: "bad-media",
              venue_title: "Bad Media Market",
              market_class: "BINARY",
              outcomes: [{ id: "NO", label: "No" }],
              network: "POLYGON",
              chain: "POLYGON",
              expires_at: "2028-05-10T00:00:00.000Z",
              resolves_at: null,
              normalized_payload: { imageUrl: "http://polymarket-upload.s3.us-east-2.amazonaws.com/insecure.png" },
              raw_source_payload: { iconUrl: "https://not-approved.example.com/icon.png" }
            }
          ]
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [mediaMarket] = await repository.listMarkets({ limit: 1 });

    expect(mediaMarket?.imageUrl).toBe("https://polymarket-upload.s3.us-east-2.amazonaws.com/media.png");
    expect(mediaMarket?.iconUrl).toBeNull();
    expect(mediaMarket?.venueMarkets[0]?.imageUrl).toBe("https://polymarket-upload.s3.us-east-2.amazonaws.com/media.png");
    expect(mediaMarket?.venueMarkets[0]?.iconUrl).toBeNull();
    expect(mediaMarket?.venueMarkets[1]?.imageUrl).toBeNull();
  });

  it("derives public source links from prefixed venue market identifiers", async () => {
    const pool = {
      query: async (_sql: string, _params?: unknown[]) => {
        if (String(_sql).includes("COUNT(*)::int AS total_count")) {
          return { rows: [{ total_count: "1" }] };
        }
        if (String(_sql).includes("venue_market_count")) {
          return {
            rows: [{
              canonical_event_id: "11111111-1111-5111-8111-111111111116",
              proposition_key: "SPORTS|CHAMPIONS",
              title: "Champions Source Link Market",
              normalized_proposition_text: "champions source link market",
              canonical_category: "SPORTS",
              market_class: "BINARY",
              starts_at: "2026-05-03T00:00:00.000Z",
              expires_at: null,
              resolves_at: null,
              updated_at: "2026-05-03T00:00:00.000Z",
              event_metadata: {},
              frontend_display_title: null,
              frontend_sort_priority: 1000,
              canonical_market_ids: ["SPORTS|CHAMPIONS"],
              venues: ["POLYMARKET", "LIMITLESS", "PREDICT"],
              venue_market_count: "4"
            }]
          };
        }
        return {
          rows: [
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111116",
              canonical_market_id: "SPORTS|CHAMPIONS",
              canonical_market_title: "Champions Source Link Market",
              venue_market_profile_id: "vmp_poly_source",
              venue: "POLYMARKET",
              venue_market_id: "POLYMARKET:uefa-champions-league-winner:SPORTS|CHAMPIONS",
              venue_title: "UEFA Champions League Winner",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }],
              network: "POLYGON",
              chain: "POLYGON",
              expires_at: null,
              resolves_at: null,
              normalized_payload: {},
              raw_source_payload: {}
            },
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111116",
              canonical_market_id: "SPORTS|CHAMPIONS",
              canonical_market_title: "Champions Source Link Market",
              venue_market_profile_id: "vmp_limitless_source",
              venue: "LIMITLESS",
              venue_market_id: "LIMITLESS:2026-fifa-world-cup-winner-1765296582257:argentina:SPORTS|CHAMPIONS",
              venue_title: "World Cup Winner",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }],
              network: "BASE",
              chain: "BASE",
              expires_at: null,
              resolves_at: null,
              normalized_payload: {},
              raw_source_payload: {}
            },
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111116",
              canonical_market_id: "SPORTS|CHAMPIONS",
              canonical_market_title: "Champions Source Link Market",
              venue_market_profile_id: "vmp_predict_source",
              venue: "PREDICT",
              venue_market_id: "PREDICT:1490:SPORTS|CHAMPIONS",
              venue_title: "NBA Champion",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }],
              network: "BASE",
              chain: "BASE",
              expires_at: null,
              resolves_at: null,
              normalized_payload: { sourceUrl: "https://predict.fun/market/2026-nba-champion" },
              raw_source_payload: {}
            },
            {
              canonical_event_id: "11111111-1111-5111-8111-111111111116",
              canonical_market_id: "SPORTS|CHAMPIONS",
              canonical_market_title: "Champions Source Link Market",
              venue_market_profile_id: "vmp_poly_condition",
              venue: "POLYMARKET",
              venue_market_id: "POLYMARKET:condition-1:SPORTS|CHAMPIONS",
              venue_title: "Condition-only Polymarket",
              market_class: "BINARY",
              outcomes: [{ id: "YES", label: "Yes" }],
              network: "POLYGON",
              chain: "POLYGON",
              expires_at: null,
              resolves_at: null,
              normalized_payload: {},
              raw_source_payload: {}
            }
          ]
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [sourceMarket] = await repository.listMarkets({ limit: 1 });
    const byProfile = new Map(sourceMarket?.venueMarkets.map((venueMarket) => [venueMarket.venueMarketProfileId, venueMarket]));

    expect(byProfile.get("vmp_poly_source")?.marketSlug).toBe("uefa-champions-league-winner");
    expect(byProfile.get("vmp_poly_source")?.eventSlug).toBe("uefa-champions-league-winner");
    expect(byProfile.get("vmp_poly_source")?.sourceUrl).toBe("https://polymarket.com/event/uefa-champions-league-winner");
    expect(byProfile.get("vmp_limitless_source")?.marketSlug).toBe("2026-fifa-world-cup-winner-1765296582257");
    expect(byProfile.get("vmp_limitless_source")?.sourceUrl).toBe("https://limitless.exchange/markets/2026-fifa-world-cup-winner-1765296582257");
    expect(byProfile.get("vmp_predict_source")?.marketSlug).toBeNull();
    expect(byProfile.get("vmp_predict_source")?.sourceUrl).toBe("https://predict.fun/market/2026-nba-champion");
    expect(byProfile.get("vmp_poly_condition")?.sourceUrl).toBeNull();
  });

  it("uses venue-provided rules and sources instead of placeholder catalog text", async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes("COUNT(*)::int AS total_count")) {
          return { rows: [{ total_count: "1" }] };
        }
        if (sql.includes("venue_market_count")) {
          return {
            rows: [{
              canonical_event_id: "11111111-1111-5111-8111-111111111117",
              proposition_key: "CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              title: "XRP all time high by September 30, 2026",
              normalized_proposition_text: "xrp all time high by september 30 2026",
              canonical_category: "CRYPTO",
              market_class: "BINARY",
              starts_at: "2026-05-03T00:00:00.000Z",
              expires_at: "2026-09-30T00:00:00.000Z",
              resolves_at: null,
              updated_at: "2026-05-03T00:00:00.000Z",
              event_metadata: {},
              frontend_display_title: null,
              frontend_sort_priority: 1000,
              canonical_market_ids: ["CRYPTO|ATH_BY_DATE|XRP|2026_09_30"],
              venues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT", "MYRIAD"],
              venue_market_count: "5"
            }]
          };
        }
        return {
          rows: [
            {
              venue_market_profile_id: "vmp_limitless_rules",
              venue: "LIMITLESS",
              venue_market_id: "LIMITLESS:september-30-2026-1775137169961:CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              venue_title: "Ath By Date Xrp 2026-09-30: 2026-09-30",
              normalized_payload: {},
              raw_source_payload: {
                marketDetail: {
                  rules: "This market resolves to Yes if XRP makes a new all-time high on or before September 30, 2026. Otherwise it resolves to No.",
                  resolutionSource: "Resolution source: venue-published Limitless market rules."
                }
              },
              resolution_rules_text: "ath by date xrp 2026 09 30 2026 09 30"
            },
            {
              venue_market_profile_id: "vmp_poly_rules",
              venue: "POLYMARKET",
              venue_market_id: "POLYMARKET:xrp-all-time-high-by-september-30-2026:CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              venue_title: "XRP ATH by September 30",
              normalized_payload: {},
              raw_source_payload: {
                market: {
                  resolutionRules: "This market resolves according to Polymarket's published XRP all-time-high rules and final market resolution.",
                  resolutionSource: "Resolution source: Polymarket market rules."
                }
              },
              resolution_rules_text: "ath by date xrp 2026 09 30 2026 09 30"
            },
            {
              venue_market_profile_id: "vmp_predict_rules",
              venue: "PREDICT",
              venue_market_id: "PREDICT:xrp-ath-september-2026:CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              venue_title: "XRP ATH by September 30",
              normalized_payload: {},
              raw_source_payload: {
                description: "This market resolves to Yes if Predict.fun's listed XRP threshold condition is met before the market close.",
                resolutionSource: "Resolution source: Predict.fun market metadata."
              },
              resolution_rules_text: "ath by date xrp 2026 09 30 2026 09 30"
            },
            {
              venue_market_profile_id: "vmp_opinion_rules",
              venue: "OPINION",
              venue_market_id: "OPINION:xrp-ath-september-2026:CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              venue_title: "XRP ATH by September 30",
              normalized_payload: {},
              raw_source_payload: {
                rules: "This market resolves by Opinion's published market rules for whether XRP reaches a new all-time high by the cutoff.",
                resolutionSource: "Resolution source: Opinion market rules."
              },
              resolution_rules_text: "ath by date xrp 2026 09 30 2026 09 30"
            },
            {
              venue_market_profile_id: "vmp_myriad_rules",
              venue: "MYRIAD",
              venue_market_id: "MYRIAD:xrp-ath-september-2026:CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
              venue_title: "XRP ATH by September 30",
              normalized_payload: {},
              raw_source_payload: {
                description: "This market resolves to Yes under the Myriad market question rules if the stated XRP ATH condition occurs.",
                resolutionSource: "Resolution source: Myriad market rules."
              },
              resolution_rules_text: "ath by date xrp 2026 09 30 2026 09 30"
            }
          ].map((row) => ({
            canonical_event_id: "11111111-1111-5111-8111-111111111117",
            canonical_market_id: "CRYPTO|ATH_BY_DATE|XRP|2026_09_30",
            canonical_market_title: "XRP all time high by September 30, 2026",
            market_class: "BINARY",
            outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
            network: null,
            chain: null,
            expires_at: "2026-09-30T00:00:00.000Z",
            resolves_at: null,
            resolution_source: null,
            resolution_title: row.venue_title,
            venue_resolution_source: null,
            venue_resolution_title: null,
            venue_resolution_rules_text: null,
            ...row
          }))
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [catalogMarket] = await repository.listMarkets({ limit: 1 });
    const byVenue = new Map(catalogMarket?.venueMarkets.map((venueMarket) => [venueMarket.venue, venueMarket]));

    expect(catalogMarket?.venueMarkets).toHaveLength(5);
    for (const venueMarket of catalogMarket?.venueMarkets ?? []) {
      expect(venueMarket.resolutionRulesText).toContain("resolves");
      expect(venueMarket.resolutionRulesText).not.toBe("ath by date xrp 2026 09 30 2026 09 30");
      expect(venueMarket.resolutionSource).toContain("Resolution source:");
    }
    expect(byVenue.get("LIMITLESS")?.resolutionRulesText).toContain("new all-time high");
    expect(byVenue.get("PREDICT_FUN")?.resolutionSource).toContain("Predict.fun");
  });

  it("resolves shared-core quote mappings when frontend sends a venue-neutral canonical market id", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(params ? { sql, params } : { sql });
        return {
          rows: [{
            venue: "POLYMARKET",
            venue_market_id: "POLYMARKET:condition-1:CANONICAL|YES",
            normalized_payload: {
              quoteMarketId: "condition-1",
              quoteOutcomeTokenIds: { YES: "token-yes", NO: "token-no" }
            },
            raw_source_payload: {}
          }]
        };
      }
    };

    const repository = new SharedCoreQuoteMappingRepository(pool as never);
    const rows = await repository.loadApprovedVenueMappings({
      canonicalMarketId: "FRONTEND_CURATED:CANONICAL|YES",
      canonicalOutcomeId: "YES"
    });

    expect(rows).toHaveLength(1);
    expect(queries[0]?.sql).toContain("regexp_replace(cem.id");
    expect(queries[0]?.sql).toContain("quoteDisabled");
    expect(queries[0]?.params?.[0]).toBe("FRONTEND_CURATED:CANONICAL|YES");
  });

  it("looks up frontend-curated market details with normalized DB proposition-key casing", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(params ? { sql, params } : { sql });
        return { rows: [] };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    await repository.getMarket(
      "FRONTEND_CURATED%3ACRYPTO%7CFDV_THRESHOLD_AFTER_LAUNCH%7CEXTENDED%7CONE_DAY_AFTER_LAUNCH%7CABOVE%7C1000000000%7C1B%3APOLYMARKET"
    );

    expect(queries[0]?.params?.[0]).toEqual(expect.arrayContaining([
      "FRONTEND_CURATED%3ACRYPTO%7CFDV_THRESHOLD_AFTER_LAUNCH%7CEXTENDED%7CONE_DAY_AFTER_LAUNCH%7CABOVE%7C1000000000%7C1B%3APOLYMARKET",
      "FRONTEND_CURATED:CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH|ABOVE|1000000000|1B:POLYMARKET",
      "FRONTEND_CURATED:CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH|ABOVE|1000000000|1B",
      "frontend-curated:CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH|ABOVE|1000000000|1B"
    ]));
  });

  it("excludes quote-disabled venue profiles from shared-core batch mappings", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(params ? { sql, params } : { sql });
        return { rows: [] };
      }
    };

    const repository = new SharedCoreQuoteMappingRepository(pool as never);
    const rows = await repository.listApprovedVenueMappings({ limit: 25 });

    expect(rows).toHaveLength(0);
    expect(queries[0]?.sql).toContain("quoteDisabled");
    expect(queries[0]?.params?.[0]).toBe(25);
  });
});
