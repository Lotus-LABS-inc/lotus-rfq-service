import type { NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";
import type { RedisClient } from "../db/redis.js";

export interface MarketOrderbookLiveCache {
  put(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    snapshot: NormalizedVenueQuoteSnapshot;
  }): Promise<void>;
  get(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly NormalizedVenueQuoteSnapshot[]>;
}

export interface RedisMarketOrderbookLiveCacheConfig {
  namespace: string;
  ttlMs: number;
  maxSnapshotsPerTopic: number;
}

const DEFAULT_CONFIG: RedisMarketOrderbookLiveCacheConfig = {
  namespace: "default",
  ttlMs: 30_000,
  maxSnapshotsPerTopic: 12
};

export class RedisMarketOrderbookLiveCache implements MarketOrderbookLiveCache {
  private readonly config: RedisMarketOrderbookLiveCacheConfig;

  public constructor(
    private readonly redis: Pick<RedisClient, "get" | "set">,
    config: Partial<RedisMarketOrderbookLiveCacheConfig> = {}
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      namespace: sanitizeNamespace(config.namespace ?? DEFAULT_CONFIG.namespace),
      ttlMs: Math.max(1_000, Math.floor(config.ttlMs ?? DEFAULT_CONFIG.ttlMs)),
      maxSnapshotsPerTopic: Math.max(1, Math.floor(config.maxSnapshotsPerTopic ?? DEFAULT_CONFIG.maxSnapshotsPerTopic))
    };
  }

  public async put(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
    snapshot: NormalizedVenueQuoteSnapshot;
  }): Promise<void> {
    const key = this.keyFor(input);
    const existing = await this.get(input);
    const updated = [input.snapshot, ...existing.filter((snapshot) => snapshotIdentity(snapshot) !== snapshotIdentity(input.snapshot))]
      .slice(0, this.config.maxSnapshotsPerTopic);
    await this.redis.set(key, JSON.stringify({
      updatedAt: new Date().toISOString(),
      snapshots: updated.map(serializeSnapshot)
    }), "PX", this.config.ttlMs);
  }

  public async get(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): Promise<readonly NormalizedVenueQuoteSnapshot[]> {
    const raw = await this.redis.get(this.keyFor(input));
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as { snapshots?: unknown };
      if (!Array.isArray(parsed.snapshots)) {
        return [];
      }
      return parsed.snapshots
        .map(parseSnapshot)
        .filter((snapshot): snapshot is NormalizedVenueQuoteSnapshot => snapshot !== null);
    } catch {
      return [];
    }
  }

  private keyFor(input: {
    canonicalMarketId: string;
    canonicalOutcomeId?: string | undefined;
  }): string {
    return [
      "lotus",
      this.config.namespace,
      "market-orderbook-live",
      encodeKeyPart(input.canonicalMarketId),
      encodeKeyPart(input.canonicalOutcomeId ?? "_")
    ].join(":");
  }
}

export const resolveMarketOrderbookLiveCacheNamespace = (source: {
  LOTUS_DEPLOY_ENV?: string | undefined;
  LOTUS_ENV?: string | undefined;
  APP_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}): string =>
  sanitizeNamespace(source.LOTUS_DEPLOY_ENV ?? source.LOTUS_ENV ?? source.APP_ENV ?? source.NODE_ENV ?? "default");

const serializeSnapshot = (snapshot: NormalizedVenueQuoteSnapshot): Record<string, unknown> => ({
  venue: snapshot.venue,
  venueMarketId: snapshot.venueMarketId,
  venueOutcomeId: snapshot.venueOutcomeId,
  source: snapshot.source,
  quoteQuality: snapshot.quoteQuality,
  sourceTimestamp: snapshot.sourceTimestamp?.toISOString() ?? null,
  receivedAt: snapshot.receivedAt.toISOString(),
  bids: snapshot.bids,
  asks: snapshot.asks,
  feeBps: snapshot.feeBps,
  fixedFee: snapshot.fixedFee,
  venueFeeBps: snapshot.venueFeeBps,
  venueFeeModel: snapshot.venueFeeModel,
  polymarketFeeRate: snapshot.polymarketFeeRate,
  polymarketCategory: snapshot.polymarketCategory,
  opinionTopicRate: snapshot.opinionTopicRate,
  limitlessMarketType: snapshot.limitlessMarketType,
  staticFeeApproved: snapshot.staticFeeApproved,
  settlementEvidenceSupported: snapshot.settlementEvidenceSupported,
  missingFactors: snapshot.missingFactors,
  blockers: snapshot.blockers,
  streamResynced: snapshot.streamResynced,
  metadata: snapshot.metadata
});

const parseSnapshot = (value: unknown): NormalizedVenueQuoteSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const venue = stringValue(record.venue);
  const venueMarketId = stringValue(record.venueMarketId);
  const source = record.source === "STREAM" || record.source === "REST" ? record.source : null;
  const quoteQuality = typeof record.quoteQuality === "string" ? record.quoteQuality : null;
  const receivedAt = dateValue(record.receivedAt);
  if (!venue || !venueMarketId || !source || !quoteQuality || !receivedAt) {
    return null;
  }
  return {
    venue,
    venueMarketId,
    ...(stringValue(record.venueOutcomeId) ? { venueOutcomeId: stringValue(record.venueOutcomeId)! } : {}),
    source,
    quoteQuality: quoteQuality as NormalizedVenueQuoteSnapshot["quoteQuality"],
    sourceTimestamp: dateValue(record.sourceTimestamp),
    receivedAt,
    bids: quoteLevels(record.bids),
    asks: quoteLevels(record.asks),
    ...(numberValue(record.feeBps) !== undefined ? { feeBps: numberValue(record.feeBps) } : {}),
    ...(numberValue(record.fixedFee) !== undefined ? { fixedFee: numberValue(record.fixedFee) } : {}),
    ...(numberValue(record.venueFeeBps) !== undefined ? { venueFeeBps: numberValue(record.venueFeeBps) } : {}),
    ...(typeof record.venueFeeModel === "string" ? { venueFeeModel: record.venueFeeModel as NormalizedVenueQuoteSnapshot["venueFeeModel"] } : {}),
    ...(numberValue(record.polymarketFeeRate) !== undefined ? { polymarketFeeRate: numberValue(record.polymarketFeeRate) } : {}),
    ...(typeof record.polymarketCategory === "string" ? { polymarketCategory: record.polymarketCategory } : {}),
    ...(numberValue(record.opinionTopicRate) !== undefined ? { opinionTopicRate: numberValue(record.opinionTopicRate) } : {}),
    ...(record.limitlessMarketType === "amm" || record.limitlessMarketType === "clob" ? { limitlessMarketType: record.limitlessMarketType } : {}),
    ...(typeof record.staticFeeApproved === "boolean" ? { staticFeeApproved: record.staticFeeApproved } : {}),
    ...(typeof record.settlementEvidenceSupported === "boolean" ? { settlementEvidenceSupported: record.settlementEvidenceSupported } : {}),
    ...(stringArray(record.missingFactors).length > 0 ? { missingFactors: stringArray(record.missingFactors) } : {}),
    ...(stringArray(record.blockers).length > 0 ? { blockers: stringArray(record.blockers) } : {}),
    ...(typeof record.streamResynced === "boolean" ? { streamResynced: record.streamResynced } : {}),
    ...(record.metadata && typeof record.metadata === "object" ? { metadata: record.metadata as Record<string, unknown> } : {})
  };
};

const quoteLevels = (value: unknown): NormalizedVenueQuoteSnapshot["bids"] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const record = entry as Record<string, unknown>;
        const price = stringValue(record.price);
        const size = stringValue(record.size);
        return price && size ? [{ price, size }] : [];
      })
    : [];

const snapshotIdentity = (snapshot: NormalizedVenueQuoteSnapshot): string =>
  `${snapshot.venue.toUpperCase()}\u0000${snapshot.venueMarketId}\u0000${snapshot.venueOutcomeId ?? ""}`;

const encodeKeyPart = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const sanitizeNamespace = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "default";
};

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const dateValue = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
