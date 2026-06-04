import { describe, expect, it, vi } from "vitest";
import { CompositeVenueQuoteSource, QuoteSnapshotCache, type NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import { HotQuoteSnapshotService, resolveHotQuoteRedisNamespace } from "../src/services/hot-quote-snapshot.service.js";

const now = new Date("2026-05-23T12:00:00.000Z");

const snapshot = (overrides: Partial<NormalizedVenueQuoteSnapshot> = {}): NormalizedVenueQuoteSnapshot => ({
  venue: "POLYMARKET",
  venueMarketId: "market-1",
  venueOutcomeId: "yes",
  source: "STREAM",
  quoteQuality: "FULL_DEPTH_STREAM",
  sourceTimestamp: now,
  receivedAt: now,
  bids: [{ price: "0.49", size: "10" }],
  asks: [{ price: "0.51", size: "10" }],
  missingFactors: [],
  blockers: [],
  streamResynced: true,
  metadata: {},
  ...overrides
});

class FakeRedis {
  public readonly values = new Map<string, string>();
  public readonly scores = new Map<string, Map<string, number>>();
  public published = 0;

  public async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async publish(): Promise<number> {
    this.published += 1;
    return 1;
  }

  public async zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.scores.get(key) ?? new Map<string, number>();
    const existed = set.has(member);
    set.set(member, score);
    this.scores.set(key, set);
    return existed ? 0 : 1;
  }

  public async zrem(key: string, member: string): Promise<number> {
    return this.scores.get(key)?.delete(member) ? 1 : 0;
  }

  public async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limitLiteral?: "LIMIT",
    offset?: number,
    count?: number
  ): Promise<string[]> {
    const minNumber = typeof min === "number" ? min : Number.NEGATIVE_INFINITY;
    const maxNumber = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
    const values = [...(this.scores.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= minNumber && score <= maxNumber)
      .sort((left, right) => left[1] - right[1])
      .map(([member]) => member);
    return limitLiteral === "LIMIT" ? values.slice(offset ?? 0, (offset ?? 0) + (count ?? values.length)) : values;
  }

  public async zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    limitLiteral?: "LIMIT",
    offset?: number,
    count?: number
  ): Promise<string[]> {
    const minNumber = typeof min === "number" ? min : Number.NEGATIVE_INFINITY;
    const maxNumber = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
    const values = [...(this.scores.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= minNumber && score <= maxNumber)
      .sort((left, right) => right[1] - left[1])
      .map(([member]) => member);
    return limitLiteral === "LIMIT" ? values.slice(offset ?? 0, (offset ?? 0) + (count ?? values.length)) : values;
  }
}

describe("HotQuoteSnapshotService", () => {
  it("serves memory snapshots before Redis and annotates freshness metadata", async () => {
    const memoryCache = new QuoteSnapshotCache();
    memoryCache.put(snapshot());
    const service = new HotQuoteSnapshotService({
      memoryCache,
      now: () => now
    });

    const result = await service.get({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes"
    });

    expect(result?.metadata?.hotSnapshotSource).toBe("memory");
    expect(result?.metadata?.hotSnapshotFreshnessMs).toBe(0);
  });

  it("writes sanitized snapshots to Redis and restores them on memory miss", async () => {
    const redis = new FakeRedis();
    const writer = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now
    });
    writer.put(snapshot({
      metadata: {
        apiKey: "secret-value",
        venueOutcomeId: "yes"
      }
    }));

    const reader = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now
    });
    const result = await reader.get({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes"
    });

    expect(result?.metadata?.hotSnapshotSource).toBe("redis");
    expect(result?.metadata?.apiKey).toBe("[REDACTED]");
    expect(result?.metadata?.venueOutcomeId).toBe("yes");
    expect(redis.published).toBe(1);
  });

  it("falls back to DB last-good snapshot when memory and Redis miss", async () => {
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      dbFallback: {
        async getLatestSnapshot() {
          return snapshot({ source: "REST", quoteQuality: "FULL_DEPTH_REST" });
        }
      },
      now: () => now
    });

    const result = await service.get({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes"
    });

    expect(result?.metadata?.hotSnapshotSource).toBe("db_last_good");
  });

  it("can skip DB fallback for display reads so UI quote routes do not block on Supabase", async () => {
    let dbCalls = 0;
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      dbFallback: {
        async getLatestSnapshot() {
          dbCalls += 1;
          return snapshot({ source: "REST", quoteQuality: "FULL_DEPTH_REST" });
        }
      },
      now: () => now
    });

    const result = await service.getDisplay({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes",
      maxAgeMs: 45_000,
      includeDbFallback: false
    });

    expect(result).toBeNull();
    expect(dbCalls).toBe(0);
  });

  it("keeps display snapshots available across recorder gaps without making strict hot reads stale-tolerant", async () => {
    const redis = new FakeRedis();
    const writer = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now
    });
    writer.put(snapshot());

    await vi.waitFor(() => {
      expect(redis.values.size).toBeGreaterThan(0);
    });

    const later = new Date(now.getTime() + 60_000);
    const reader = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => later
    });

    await expect(reader.get({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes"
    })).resolves.toBeNull();

    const display = await reader.getDisplay({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes",
      maxAgeMs: 120_000,
      includeDbFallback: false
    });
    expect(display?.metadata?.hotSnapshotSource).toBe("redis");
    expect(display?.metadata?.hotSnapshotFreshnessMs).toBe(60_000);
  });

  it("prefers fresher Redis display snapshots over stale in-memory display snapshots", async () => {
    const redis = new FakeRedis();
    const freshAt = new Date(now.getTime() + 20_000);
    const writer = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => freshAt
    });
    writer.put(snapshot({
      receivedAt: freshAt,
      sourceTimestamp: freshAt,
      bids: [{ price: "0.58", size: "10" }],
      asks: [{ price: "0.60", size: "10" }]
    }));
    await vi.waitFor(() => {
      expect(redis.values.size).toBeGreaterThan(0);
    });

    const memoryCache = new QuoteSnapshotCache();
    memoryCache.put(snapshot({
      receivedAt: now,
      sourceTimestamp: now,
      bids: [{ price: "0.48", size: "10" }],
      asks: [{ price: "0.50", size: "10" }]
    }));
    const reader = new HotQuoteSnapshotService({
      memoryCache,
      redis,
      now: () => freshAt
    });

    const display = await reader.getDisplay({
      venue: "POLYMARKET",
      venueMarketId: "market-1",
      venueOutcomeId: "yes",
      maxAgeMs: 120_000,
      includeDbFallback: false
    });

    expect(display?.metadata?.hotSnapshotSource).toBe("redis");
    expect(display?.metadata?.hotSnapshotFreshnessMs).toBe(0);
    expect(display?.bids[0]?.price).toBe("0.58");
  });

  it("tracks active markets and expires idle entries", () => {
    let current = now;
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      now: () => current,
      config: { activeMarketTtlMs: 1_000 }
    });

    service.touch({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });
    expect(service.listActiveMarkets()).toEqual([{
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      lastSeenAt: now
    }]);

    current = new Date(now.getTime() + 1_500);
    expect(service.activeMarketCount()).toBe(0);
  });

  it("writes active market targets to Redis for the dedicated stream service", async () => {
    const redis = new FakeRedis();
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now,
      config: { activeMarketTtlMs: 60_000 }
    });

    service.touch({ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES" });
    await vi.waitFor(() => {
      expect(redis.scores.size).toBeGreaterThan(0);
    });

    const result = await service.listActiveMarketsFromRedis();
    expect(result).toEqual([{
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      lastSeenAt: now
    }]);
  });

  it("lists newest Redis-active markets first so opened pages get stream priority", async () => {
    const redis = new FakeRedis();
    let current = now;
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => current,
      config: { activeMarketTtlMs: 60_000 }
    });

    service.touch({ canonicalMarketId: "older-market" });
    current = new Date(now.getTime() + 1_000);
    service.touch({ canonicalMarketId: "newer-market" });
    await vi.waitFor(() => {
      expect(redis.scores.size).toBeGreaterThan(0);
    });

    const result = await service.listActiveMarketsFromRedis({ limit: 2 });
    expect(result.map((entry) => entry.canonicalMarketId)).toEqual(["newer-market", "older-market"]);
  });

  it("orders Redis-active markets by touchedAt even when older entries have legacy expiry scores", async () => {
    const redis = new FakeRedis();
    let current = now;
    const service = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => current,
      config: { activeMarketTtlMs: 60_000 }
    });

    service.touch({ canonicalMarketId: "older-market" });
    await vi.waitFor(() => {
      expect(redis.scores.size).toBeGreaterThan(0);
    });
    for (const scoreSet of redis.scores.values()) {
      for (const member of scoreSet.keys()) {
        scoreSet.set(member, now.getTime() + 180_000);
      }
    }

    current = new Date(now.getTime() + 1_000);
    service.touch({ canonicalMarketId: "newer-market" });
    await vi.waitFor(() => {
      expect(redis.values.size).toBeGreaterThan(1);
    });

    const result = await service.listActiveMarketsFromRedis({ limit: 2 });
    expect(result.map((entry) => entry.canonicalMarketId)).toEqual(["newer-market", "older-market"]);
  });

  it("isolates hot quote and active-market Redis keys by environment namespace", async () => {
    const redis = new FakeRedis();
    const staging = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now,
      config: { redisNamespace: "staging" }
    });
    const prod = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      redis,
      now: () => now,
      config: { redisNamespace: "prod" }
    });

    staging.touch({ canonicalMarketId: "staging-market" });
    staging.put(snapshot({ venueMarketId: "staging-venue-market" }));
    await vi.waitFor(() => {
      expect(redis.values.size).toBeGreaterThan(1);
    });

    await expect(prod.listActiveMarketsFromRedis()).resolves.toEqual([]);
    await expect(prod.getDisplay({
      venue: "POLYMARKET",
      venueMarketId: "staging-venue-market",
      venueOutcomeId: "yes",
      maxAgeMs: 15_000,
      includeDbFallback: false
    })).resolves.toBeNull();
  });

  it("derives a sanitized Redis namespace from deploy labels", () => {
    expect(resolveHotQuoteRedisNamespace({ LOTUS_DEPLOY_ENV: "staging" })).toBe("staging");
    expect(resolveHotQuoteRedisNamespace({ LOTUS_ENV: "Production" })).toBe("production");
    expect(resolveHotQuoteRedisNamespace({ APP_ENV: "vps prod" })).toBe("vps-prod");
  });

  it("lets CompositeVenueQuoteSource use hot snapshots before live readers and refill hot cache from REST", async () => {
    const hotStore = new HotQuoteSnapshotService({
      memoryCache: new QuoteSnapshotCache(),
      now: () => now
    });
    hotStore.put(snapshot());
    let readerCalls = 0;
    const source = new CompositeVenueQuoteSource([
      {
        venue: "POLYMARKET",
        async getQuoteSnapshot() {
          readerCalls += 1;
          return snapshot({ source: "REST", quoteQuality: "FULL_DEPTH_REST" });
        }
      }
    ], {
      async resolve() {
        return [];
      },
      async getReadiness() {
        return [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-1",
          venueMarketId: "market-1",
          venueOutcomeId: "yes",
          quoteReady: true,
          blockers: []
        }];
      }
    }, () => now, hotStore);

    const report = await source.getQuoteSnapshotReport({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      side: "buy",
      quantity: 1
    });

    expect(report.snapshots[0]?.source).toBe("STREAM");
    expect(report.snapshots[0]?.metadata?.hotSnapshotSource).toBe("memory");
    expect(readerCalls).toBe(0);
  });
});
