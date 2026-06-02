import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";
import type { NormalizedVenueQuoteSnapshot, QuoteSnapshotCache } from "../core/sor/quote-snapshot.js";

export interface HotQuoteSnapshotConfig {
  redisTtlMs: number;
  staleAfterMs: number;
  activeMarketTtlMs: number;
}

export interface HotQuoteSnapshotDbFallback {
  getLatestSnapshot(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs: number;
  }): Promise<NormalizedVenueQuoteSnapshot | null>;
}

export interface HotQuoteSnapshotServiceConfig {
  memoryCache: QuoteSnapshotCache;
  redis?: Pick<RedisClient, "get" | "set" | "publish" | "zadd" | "zrem" | "zrangebyscore"> | undefined;
  dbFallback?: HotQuoteSnapshotDbFallback | undefined;
  logger?: Pick<Logger, "warn" | "debug"> | undefined;
  now?: () => Date;
  config?: Partial<HotQuoteSnapshotConfig> | undefined;
}

export type HotQuoteSnapshotSource = "memory" | "redis" | "db_last_good";

const DEFAULT_CONFIG: HotQuoteSnapshotConfig = {
  redisTtlMs: 15_000,
  staleAfterMs: 1_000,
  activeMarketTtlMs: 60_000
};

const REDIS_KEY_PREFIX = "lotus:quote-snapshot:v1";
const REDIS_CHANNEL = "lotus:quote-snapshot:updates:v1";
const REDIS_ACTIVE_MARKETS_INDEX = "lotus:orderbook-active:v1:index";
const REDIS_ACTIVE_MARKETS_KEY_PREFIX = "lotus:orderbook-active:v1:target";

export class HotQuoteSnapshotService {
  private readonly now: () => Date;
  private readonly config: HotQuoteSnapshotConfig;
  private readonly activeMarkets = new Map<string, number>();

  public constructor(private readonly deps: HotQuoteSnapshotServiceConfig) {
    this.now = deps.now ?? (() => new Date());
    this.config = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
  }

  public touch(input: { canonicalMarketId: string; canonicalOutcomeId?: string | undefined }): void {
    this.pruneInactiveMarkets();
    const touchedAt = this.now();
    this.activeMarkets.set(activeKey(input.canonicalMarketId, input.canonicalOutcomeId), touchedAt.getTime());
    void this.writeActiveMarketRedis(input, touchedAt);
  }

  public activeMarketCount(): number {
    this.pruneInactiveMarkets();
    return this.activeMarkets.size;
  }

  public listActiveMarkets(): Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined; lastSeenAt: Date }> {
    this.pruneInactiveMarkets();
    return [...this.activeMarkets.entries()].map(([key, lastSeenAt]) => {
      const [canonicalMarketId, canonicalOutcomeId] = key.split("\u0000", 2);
      return {
        canonicalMarketId: canonicalMarketId ?? "",
        ...(canonicalOutcomeId ? { canonicalOutcomeId } : {}),
        lastSeenAt: new Date(lastSeenAt)
      };
    }).filter((entry) => entry.canonicalMarketId.length > 0);
  }

  public async listActiveMarketsFromRedis(input: {
    limit?: number | undefined;
  } = {}): Promise<Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined; lastSeenAt: Date }>> {
    if (!this.deps.redis) {
      return this.listActiveMarkets();
    }

    const nowMs = this.now().getTime();
    const limit = Math.max(1, Math.min(input.limit ?? 500, 2_000));
    try {
      const keys = await this.deps.redis.zrangebyscore(
        REDIS_ACTIVE_MARKETS_INDEX,
        nowMs,
        "+inf",
        "LIMIT",
        0,
        limit
      );
      const results: Array<{ canonicalMarketId: string; canonicalOutcomeId?: string | undefined; lastSeenAt: Date }> = [];
      for (const key of keys) {
        const raw = await this.deps.redis.get(key);
        const parsed = raw ? parseActiveMarket(raw, nowMs, this.config.activeMarketTtlMs) : null;
        if (!parsed) {
          await this.deps.redis.zrem(REDIS_ACTIVE_MARKETS_INDEX, key);
          continue;
        }
        results.push(parsed);
      }
      return results;
    } catch (error) {
      this.deps.logger?.warn({ err: error }, "Hot quote active market Redis read failed.");
      return this.listActiveMarkets();
    }
  }

  public put(snapshot: NormalizedVenueQuoteSnapshot): void {
    this.deps.memoryCache.put(snapshot);
    void this.writeRedis(snapshot);
  }

  public async get(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null> {
    const memory = this.deps.memoryCache.get(input);
    if (memory && this.isHot(memory)) {
      return annotateSnapshot(memory, "memory", this.now());
    }

    const redis = await this.readRedis(input);
    if (redis && this.isHot(redis)) {
      this.deps.memoryCache.put(redis);
      return annotateSnapshot(redis, "redis", this.now());
    }

    const db = await this.readDb(input);
    if (db) {
      this.deps.memoryCache.put(db);
      return annotateSnapshot(db, "db_last_good", this.now());
    }

    return null;
  }

  public async getDisplay(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
    maxAgeMs: number;
  }): Promise<NormalizedVenueQuoteSnapshot | null> {
    const maxAgeMs = Math.max(this.config.staleAfterMs, Math.min(input.maxAgeMs, 5 * 60_000));
    const memory = this.deps.memoryCache.get(input);
    if (memory && this.isWithinAge(memory, maxAgeMs)) {
      return annotateSnapshot(memory, "memory", this.now());
    }

    const redis = await this.readRedis(input);
    if (redis && this.isWithinAge(redis, maxAgeMs)) {
      this.deps.memoryCache.put(redis);
      return annotateSnapshot(redis, "redis", this.now());
    }

    const db = await this.readDb(input, maxAgeMs);
    if (db) {
      this.deps.memoryCache.put(db);
      return annotateSnapshot(db, "db_last_good", this.now());
    }

    return null;
  }

  private isHot(snapshot: NormalizedVenueQuoteSnapshot): boolean {
    return this.isWithinAge(snapshot, this.config.staleAfterMs);
  }

  private isWithinAge(snapshot: NormalizedVenueQuoteSnapshot, maxAgeMs: number): boolean {
    return this.now().getTime() - snapshot.receivedAt.getTime() <= maxAgeMs;
  }

  private pruneInactiveMarkets(): void {
    const cutoff = this.now().getTime() - this.config.activeMarketTtlMs;
    for (const [key, lastSeenAt] of this.activeMarkets.entries()) {
      if (lastSeenAt < cutoff) {
        this.activeMarkets.delete(key);
      }
    }
  }

  private async writeRedis(snapshot: NormalizedVenueQuoteSnapshot): Promise<void> {
    if (!this.deps.redis) {
      return;
    }
    const payload = JSON.stringify(serializeSnapshot(snapshot));
    const ttlMs = Math.max(1, Math.floor(this.config.redisTtlMs));
    try {
      await this.deps.redis.set(redisKey(snapshot), payload, "PX", ttlMs);
      await this.deps.redis.publish(REDIS_CHANNEL, JSON.stringify({
        venue: snapshot.venue.toUpperCase(),
        venueMarketId: snapshot.venueMarketId,
        venueOutcomeId: snapshot.venueOutcomeId ?? null,
        receivedAt: snapshot.receivedAt.toISOString()
      }));
    } catch (error) {
      this.deps.logger?.warn({ err: error, venue: snapshot.venue }, "Hot quote snapshot Redis write failed.");
    }
  }

  private async writeActiveMarketRedis(
    input: { canonicalMarketId: string; canonicalOutcomeId?: string | undefined },
    touchedAt: Date
  ): Promise<void> {
    if (!this.deps.redis) {
      return;
    }
    const key = activeRedisKey(input.canonicalMarketId, input.canonicalOutcomeId);
    const expiresAtMs = touchedAt.getTime() + this.config.activeMarketTtlMs;
    const payload = JSON.stringify({
      canonicalMarketId: input.canonicalMarketId,
      canonicalOutcomeId: input.canonicalOutcomeId ?? null,
      touchedAt: touchedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
    try {
      await this.deps.redis.set(key, payload, "PX", Math.max(1, Math.floor(this.config.activeMarketTtlMs)));
      await this.deps.redis.zadd(REDIS_ACTIVE_MARKETS_INDEX, expiresAtMs, key);
    } catch (error) {
      this.deps.logger?.warn(
        { err: error, canonicalMarketId: input.canonicalMarketId },
        "Hot quote active market Redis write failed."
      );
    }
  }

  private async readRedis(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
  }): Promise<NormalizedVenueQuoteSnapshot | null> {
    if (!this.deps.redis) {
      return null;
    }
    try {
      const raw = await this.deps.redis.get(redisKey(input));
      return raw ? parseSnapshot(raw) : null;
    } catch (error) {
      this.deps.logger?.warn({ err: error, venue: input.venue }, "Hot quote snapshot Redis read failed.");
      return null;
    }
  }

  private async readDb(input: {
    venue: string;
    venueMarketId: string;
    venueOutcomeId?: string | undefined;
  }, maxAgeMs: number = this.config.redisTtlMs): Promise<NormalizedVenueQuoteSnapshot | null> {
    if (!this.deps.dbFallback) {
      return null;
    }
    try {
      return await this.deps.dbFallback.getLatestSnapshot({
        ...input,
        maxAgeMs
      });
    } catch (error) {
      this.deps.logger?.debug?.({ err: error, venue: input.venue }, "Hot quote snapshot DB fallback read failed.");
      return null;
    }
  }
}

const serializeSnapshot = (snapshot: NormalizedVenueQuoteSnapshot): Record<string, unknown> => ({
  ...snapshot,
  venue: snapshot.venue.toUpperCase(),
  sourceTimestamp: snapshot.sourceTimestamp?.toISOString() ?? null,
  receivedAt: snapshot.receivedAt.toISOString(),
  metadata: sanitizeRecord(snapshot.metadata ?? {})
});

const parseSnapshot = (raw: string): NormalizedVenueQuoteSnapshot | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    const venue = stringField(record.venue);
    const venueMarketId = stringField(record.venueMarketId);
    const source = record.source === "STREAM" || record.source === "REST" ? record.source : null;
    const quoteQuality = stringField(record.quoteQuality);
    const receivedAt = dateField(record.receivedAt);
    if (!venue || !venueMarketId || !source || !quoteQuality || !receivedAt) {
      return null;
    }
    return {
      venue,
      venueMarketId,
      ...(stringField(record.venueOutcomeId) ? { venueOutcomeId: stringField(record.venueOutcomeId)! } : {}),
      source,
      quoteQuality: quoteQuality as NormalizedVenueQuoteSnapshot["quoteQuality"],
      sourceTimestamp: dateField(record.sourceTimestamp),
      receivedAt,
      bids: levelArray(record.bids),
      asks: levelArray(record.asks),
      ...(numberField(record.feeBps) !== undefined ? { feeBps: numberField(record.feeBps) } : {}),
      ...(numberField(record.fixedFee) !== undefined ? { fixedFee: numberField(record.fixedFee) } : {}),
      ...(numberField(record.venueFeeBps) !== undefined ? { venueFeeBps: numberField(record.venueFeeBps) } : {}),
      ...(numberField(record.polymarketFeeRate) !== undefined ? { polymarketFeeRate: numberField(record.polymarketFeeRate) } : {}),
      ...(stringField(record.polymarketCategory) ? { polymarketCategory: stringField(record.polymarketCategory)! } : {}),
      ...(numberField(record.opinionTopicRate) !== undefined ? { opinionTopicRate: numberField(record.opinionTopicRate) } : {}),
      ...(record.limitlessMarketType === "amm" || record.limitlessMarketType === "clob" ? { limitlessMarketType: record.limitlessMarketType } : {}),
      ...(booleanField(record.staticFeeApproved) !== undefined ? { staticFeeApproved: booleanField(record.staticFeeApproved) } : {}),
      ...(booleanField(record.settlementEvidenceSupported) !== undefined ? { settlementEvidenceSupported: booleanField(record.settlementEvidenceSupported) } : {}),
      missingFactors: stringArray(record.missingFactors),
      blockers: stringArray(record.blockers),
      ...(booleanField(record.streamResynced) !== undefined ? { streamResynced: booleanField(record.streamResynced) } : {}),
      metadata: sanitizeRecord(record.metadata)
    };
  } catch {
    return null;
  }
};

const annotateSnapshot = (
  snapshot: NormalizedVenueQuoteSnapshot,
  source: HotQuoteSnapshotSource,
  now: Date
): NormalizedVenueQuoteSnapshot => ({
  ...snapshot,
  metadata: {
    ...(snapshot.metadata ?? {}),
    hotSnapshotSource: source,
    hotSnapshotFreshnessMs: Math.max(0, now.getTime() - snapshot.receivedAt.getTime())
  }
});

const redisKey = (input: { venue: string; venueMarketId: string; venueOutcomeId?: string | undefined }): string =>
  `${REDIS_KEY_PREFIX}:${input.venue.toUpperCase()}:${encode(input.venueMarketId)}:${encode(input.venueOutcomeId ?? "_")}`;

const encode = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const activeRedisKey = (canonicalMarketId: string, canonicalOutcomeId: string | undefined): string =>
  `${REDIS_ACTIVE_MARKETS_KEY_PREFIX}:${encode(activeKey(canonicalMarketId, canonicalOutcomeId))}`;

const activeKey = (canonicalMarketId: string, canonicalOutcomeId: string | undefined): string =>
  `${canonicalMarketId}\u0000${canonicalOutcomeId ?? ""}`;

const parseActiveMarket = (
  raw: string,
  nowMs: number,
  ttlMs: number
): { canonicalMarketId: string; canonicalOutcomeId?: string | undefined; lastSeenAt: Date } | null => {
  try {
    const record = asRecord(JSON.parse(raw) as unknown);
    const canonicalMarketId = stringField(record.canonicalMarketId);
    const touchedAt = dateField(record.touchedAt);
    if (!canonicalMarketId || !touchedAt || nowMs - touchedAt.getTime() > ttlMs) {
      return null;
    }
    const canonicalOutcomeId = stringField(record.canonicalOutcomeId);
    return {
      canonicalMarketId,
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {}),
      lastSeenAt: touchedAt
    };
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const numberField = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanField = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const dateField = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const levelArray = (value: unknown): NormalizedVenueQuoteSnapshot["bids"] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
      const record = asRecord(entry);
      const price = stringField(record.price);
      const size = stringField(record.size);
      return price && size ? [{ price, size }] : [];
    })
    : [];

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

const sanitizeRecord = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (/api|key|secret|token|signature|hmac|auth|header/i.test(key) && !/venueOutcomeId|quoteTokenId|tokenId|topic/i.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeValue(entry);
  }
  return output;
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === "object" && value !== null) {
    return sanitizeRecord(value);
  }
  return value;
};
