import type { Logger } from "pino";
import type {
  NormalizedVenueQuoteSnapshot,
  SharedCoreQuoteReadinessMarket,
  VenueQuoteMappingReadiness,
  VenueQuoteMappingResolver
} from "../core/sor/quote-snapshot.js";
import type { RedisClient } from "../db/redis.js";
import type { HotQuoteSnapshotService } from "./hot-quote-snapshot.service.js";

export interface ActiveOrderbookMarket {
  canonicalMarketId: string;
  canonicalOutcomeId?: string | undefined;
  lastSeenAt: Date;
}

export interface VenueOrderbookSubscriptionTarget {
  canonicalMarketId: string;
  canonicalOutcomeId?: string | undefined;
  venue: string;
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
}

export interface VenueOrderbookStreamConnector {
  readonly venue: string;
  subscribe(
    targets: readonly VenueOrderbookSubscriptionTarget[],
    onSnapshot: (snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget) => void
  ): Promise<void>;
  unsubscribe(subscriptionKeys: readonly string[]): Promise<void>;
  disconnect(): Promise<void>;
}

export interface OrderbookStreamServiceConfig {
  pollIntervalMs: number;
  activeMarketLimit: number;
}

export interface OrderbookStreamServiceDeps {
  activeMarkets: Pick<HotQuoteSnapshotService, "listActiveMarketsFromRedis">;
  hotSnapshots: Pick<HotQuoteSnapshotService, "put">;
  mappingResolver: Pick<VenueQuoteMappingResolver, "getReadiness" | "listApprovedReadiness">;
  connectors: readonly VenueOrderbookStreamConnector[];
  publisher: Pick<RedisClient, "publish">;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now?: () => Date;
  config?: Partial<OrderbookStreamServiceConfig> | undefined;
  redisChannel?: string | undefined;
}

export interface OrderbookStreamServiceRunResult {
  activeMarkets: number;
  desiredSubscriptions: number;
  subscribed: number;
  unsubscribed: number;
  unsupportedVenueTargets: number;
}

const DEFAULT_CONFIG: OrderbookStreamServiceConfig = {
  pollIntervalMs: 1_000,
  activeMarketLimit: 500
};

export const ORDERBOOK_GATEWAY_REDIS_CHANNEL = "rfq:gateway:events";

export class OrderbookStreamService {
  private readonly config: OrderbookStreamServiceConfig;
  private readonly now: () => Date;
  private readonly redisChannel: string;
  private readonly connectorsByVenue: ReadonlyMap<string, VenueOrderbookStreamConnector>;
  private readonly activeSubscriptionKeys = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(private readonly deps: OrderbookStreamServiceDeps) {
    this.config = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
    this.now = deps.now ?? (() => new Date());
    this.redisChannel = deps.redisChannel ?? ORDERBOOK_GATEWAY_REDIS_CHANNEL;
    this.connectorsByVenue = new Map(deps.connectors.map((connector) => [normalizeVenue(connector.venue), connector]));
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.deps.logger.info(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        activeMarketLimit: this.config.activeMarketLimit,
        venues: [...this.connectorsByVenue.keys()].sort()
      },
      "Orderbook stream service started."
    );
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.pollIntervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const disconnects = [...this.connectorsByVenue.values()].map((connector) => connector.disconnect());
    await Promise.allSettled(disconnects);
    this.activeSubscriptionKeys.clear();
    this.deps.logger.info({}, "Orderbook stream service stopped.");
  }

  public async runOnce(): Promise<OrderbookStreamServiceRunResult> {
    const empty = emptyResult();
    if (this.running) {
      return empty;
    }

    this.running = true;
    try {
      const activeMarkets = await this.deps.activeMarkets.listActiveMarketsFromRedis({
        limit: this.config.activeMarketLimit
      });
      const desiredTargets = await this.resolveTargets(activeMarkets);
      const desiredKeys = new Set(desiredTargets.map(subscriptionKey));
      const staleKeys = [...this.activeSubscriptionKeys].filter((key) => !desiredKeys.has(key));
      const newTargets = desiredTargets.filter((target) => !this.activeSubscriptionKeys.has(subscriptionKey(target)));

      await this.unsubscribe(staleKeys);
      await this.subscribe(newTargets);

      for (const key of staleKeys) {
        this.activeSubscriptionKeys.delete(key);
      }
      for (const target of newTargets) {
        this.activeSubscriptionKeys.add(subscriptionKey(target));
      }

      return {
        activeMarkets: activeMarkets.length,
        desiredSubscriptions: desiredTargets.length,
        subscribed: newTargets.length,
        unsubscribed: staleKeys.length,
        unsupportedVenueTargets: desiredTargets.filter((target) => !this.connectorsByVenue.has(normalizeVenue(target.venue))).length
      };
    } catch (error) {
      this.deps.logger.warn({ err: error }, "Orderbook stream service tick failed.");
      return empty;
    } finally {
      this.running = false;
    }
  }

  private async resolveTargets(activeMarkets: readonly ActiveOrderbookMarket[]): Promise<readonly VenueOrderbookSubscriptionTarget[]> {
    const batchReadiness = await this.loadBatchReadiness(activeMarkets.length);
    const results: VenueOrderbookSubscriptionTarget[][] = [];
    for (const market of activeMarkets) {
      const readiness = batchReadiness
        ? batchReadiness.get(market.canonicalMarketId) ?? []
        : await this.loadSingleReadiness(market);
      const targets = readiness
        .filter(isQuoteReadyMapping)
        .map((row): VenueOrderbookSubscriptionTarget => ({
          canonicalMarketId: market.canonicalMarketId,
          ...(market.canonicalOutcomeId ? { canonicalOutcomeId: market.canonicalOutcomeId } : {}),
          venue: normalizeVenue(row.venue),
          venueMarketId: row.venueMarketId!,
          ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
        }));
      results.push(targets);
    }
    return dedupeTargets(results.flat());
  }

  private async loadBatchReadiness(
    activeMarketCount: number
  ): Promise<ReadonlyMap<string, readonly VenueQuoteMappingReadiness[]> | null> {
    if (!this.deps.mappingResolver.listApprovedReadiness) {
      return null;
    }
    const rows = await this.deps.mappingResolver.listApprovedReadiness({
      limit: Math.max(activeMarketCount, this.config.activeMarketLimit)
    });
    return readinessByCanonicalMarket(rows);
  }

  private async loadSingleReadiness(market: ActiveOrderbookMarket): Promise<readonly VenueQuoteMappingReadiness[]> {
    if (!this.deps.mappingResolver.getReadiness) {
      return [];
    }
    return this.deps.mappingResolver.getReadiness({
      canonicalMarketId: market.canonicalMarketId,
      ...(market.canonicalOutcomeId ? { canonicalOutcomeId: market.canonicalOutcomeId } : {})
    });
  }

  private async subscribe(targets: readonly VenueOrderbookSubscriptionTarget[]): Promise<void> {
    const grouped = groupByVenue(targets);
    await Promise.all([...grouped.entries()].map(async ([venue, venueTargets]) => {
      const connector = this.connectorsByVenue.get(venue);
      if (!connector) {
        this.deps.logger.warn({ venue, targetCount: venueTargets.length }, "No orderbook stream connector registered for venue.");
        return;
      }
      try {
        await connector.subscribe(venueTargets, (snapshot, target) => {
          this.onSnapshot(snapshot, target);
        });
      } catch (error) {
        this.deps.logger.warn({ err: error, venue, targetCount: venueTargets.length }, "Venue orderbook subscribe failed.");
      }
    }));
  }

  private async unsubscribe(subscriptionKeys: readonly string[]): Promise<void> {
    const keysByVenue = new Map<string, string[]>();
    for (const key of subscriptionKeys) {
      const venue = key.split("|", 1)[0] ?? "";
      const bucket = keysByVenue.get(venue) ?? [];
      bucket.push(key);
      keysByVenue.set(venue, bucket);
    }
    await Promise.all([...keysByVenue.entries()].map(async ([venue, keys]) => {
      const connector = this.connectorsByVenue.get(venue);
      if (!connector) {
        return;
      }
      try {
        await connector.unsubscribe(keys);
      } catch (error) {
        this.deps.logger.warn({ err: error, venue, targetCount: keys.length }, "Venue orderbook unsubscribe failed.");
      }
    }));
  }

  private onSnapshot(snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget): void {
    this.deps.hotSnapshots.put(snapshot);
    void this.publishMarketUpdate(snapshot, target);
  }

  private async publishMarketUpdate(
    snapshot: NormalizedVenueQuoteSnapshot,
    target: VenueOrderbookSubscriptionTarget
  ): Promise<void> {
    const event = {
      type: "MARKET_ORDERBOOK_UPDATE",
      topic: marketOrderbookTopic(target.canonicalMarketId, target.canonicalOutcomeId),
      emittedAt: this.now().toISOString(),
      payload: {
        canonicalMarketId: target.canonicalMarketId,
        canonicalOutcomeId: target.canonicalOutcomeId ?? null,
        venue: normalizeVenue(snapshot.venue),
        venueMarketId: snapshot.venueMarketId,
        venueOutcomeId: snapshot.venueOutcomeId ?? null,
        source: "stream",
        quoteQuality: snapshot.quoteQuality,
        bestBid: snapshot.bids[0]?.price ?? null,
        bestAsk: snapshot.asks[0]?.price ?? null,
        bidSize: snapshot.bids[0]?.size ?? null,
        askSize: snapshot.asks[0]?.size ?? null,
        freshnessMs: Math.max(0, this.now().getTime() - snapshot.receivedAt.getTime()),
        snapshotStatus: snapshot.blockers && snapshot.blockers.length > 0 ? "blocked" : "live",
        blockers: sanitizeStrings(snapshot.blockers ?? []),
        bids: snapshot.bids.slice(0, 5),
        asks: snapshot.asks.slice(0, 5)
      }
    };
    try {
      await this.deps.publisher.publish(this.redisChannel, JSON.stringify(event));
    } catch (error) {
      this.deps.logger.warn({ err: error, venue: snapshot.venue }, "Orderbook stream gateway publish failed.");
    }
  }
}

export const marketOrderbookTopic = (canonicalMarketId: string, canonicalOutcomeId?: string | undefined): string =>
  `markets:orderbook:${topicPart(canonicalMarketId)}:${topicPart(canonicalOutcomeId ?? "_")}`;

export const subscriptionKey = (target: VenueOrderbookSubscriptionTarget): string =>
  [
    normalizeVenue(target.venue),
    target.venueMarketId,
    target.venueOutcomeId ?? "_",
    target.canonicalMarketId,
    target.canonicalOutcomeId ?? "_"
  ].join("|");

const isQuoteReadyMapping = (
  row: VenueQuoteMappingReadiness
): row is VenueQuoteMappingReadiness & { venueMarketId: string } =>
  row.quoteReady && row.venueMarketId !== null;

const dedupeTargets = (targets: readonly VenueOrderbookSubscriptionTarget[]): readonly VenueOrderbookSubscriptionTarget[] => {
  const byKey = new Map<string, VenueOrderbookSubscriptionTarget>();
  for (const target of targets) {
    byKey.set(subscriptionKey(target), target);
  }
  return [...byKey.values()];
};

const groupByVenue = (targets: readonly VenueOrderbookSubscriptionTarget[]): ReadonlyMap<string, VenueOrderbookSubscriptionTarget[]> => {
  const grouped = new Map<string, VenueOrderbookSubscriptionTarget[]>();
  for (const target of targets) {
    const venue = normalizeVenue(target.venue);
    const bucket = grouped.get(venue) ?? [];
    bucket.push(target);
    grouped.set(venue, bucket);
  }
  return grouped;
};

const readinessByCanonicalMarket = (
  rows: readonly SharedCoreQuoteReadinessMarket[]
): ReadonlyMap<string, readonly VenueQuoteMappingReadiness[]> => {
  const byMarket = new Map<string, VenueQuoteMappingReadiness[]>();
  for (const row of rows) {
    const marketIds = row.canonicalMarketIds.length > 0
      ? row.canonicalMarketIds
      : [row.canonicalEventId];
    for (const marketId of marketIds) {
      byMarket.set(marketId, [...(byMarket.get(marketId) ?? []), ...row.venues]);
    }
  }
  return byMarket;
};

const topicPart = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};

const sanitizeStrings = (values: readonly string[]): readonly string[] =>
  values
    .map((value) => value.replace(/[A-Za-z0-9_-]{32,}/g, "REDACTED").slice(0, 120))
    .filter((value) => value.trim().length > 0);

const emptyResult = (): OrderbookStreamServiceRunResult => ({
  activeMarkets: 0,
  desiredSubscriptions: 0,
  subscribed: 0,
  unsubscribed: 0,
  unsupportedVenueTargets: 0
});
