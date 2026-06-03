import type { Logger } from "pino";
import type {
  NormalizedVenueQuoteSnapshot,
  SharedCoreQuoteReadinessMarket,
  VenueQuoteSnapshotReader,
  VenueQuoteMappingReadiness,
  VenueQuoteMappingResolver
} from "../core/sor/quote-snapshot.js";
import type { RedisClient } from "../db/redis.js";
import type { HotQuoteSnapshotService } from "./hot-quote-snapshot.service.js";
import type { MarketOrderbookLiveCache } from "./market-orderbook-live-cache.js";

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
  backgroundReadinessMarketLimit: number;
  maxBackgroundSubscriptionTargets: number;
  maxSubscribeTargetsPerTick: number;
  maxUnsubscribeTargetsPerTick: number;
  maxTargetsPerConnectorCall: number;
  subscriptionHoldMs: number;
  restRefreshIntervalMs: number;
  maxRestRefreshTargetsPerTick: number;
  maxRestRefreshTargetsPerVenuePerTick: number;
  restRefreshTimeoutMs: number;
  summaryLogIntervalMs: number;
}

export interface VenueOrderbookRestRefresher {
  readonly venue: string;
  refresh(target: VenueOrderbookSubscriptionTarget): Promise<NormalizedVenueQuoteSnapshot | null>;
}

export interface OrderbookStreamServiceDeps {
  activeMarkets: Pick<HotQuoteSnapshotService, "listActiveMarketsFromRedis">;
  hotSnapshots: Pick<HotQuoteSnapshotService, "put">;
  liveOrderbooks?: MarketOrderbookLiveCache | undefined;
  mappingResolver: Pick<VenueQuoteMappingResolver, "getReadiness" | "listApprovedReadiness">;
  connectors: readonly VenueOrderbookStreamConnector[];
  restRefreshers?: readonly VenueOrderbookRestRefresher[] | readonly VenueQuoteSnapshotReader[] | undefined;
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
  retainedSubscriptions: number;
  pendingSubscriptions: number;
  restRefreshed: number;
}

const DEFAULT_CONFIG: OrderbookStreamServiceConfig = {
  pollIntervalMs: 1_000,
  activeMarketLimit: 500,
  backgroundReadinessMarketLimit: 250,
  maxBackgroundSubscriptionTargets: 240,
  maxSubscribeTargetsPerTick: 160,
  maxUnsubscribeTargetsPerTick: 40,
  maxTargetsPerConnectorCall: 40,
  subscriptionHoldMs: 120_000,
  restRefreshIntervalMs: 5_000,
  maxRestRefreshTargetsPerTick: 48,
  maxRestRefreshTargetsPerVenuePerTick: 12,
  restRefreshTimeoutMs: 2_000,
  summaryLogIntervalMs: 15_000
};

export const ORDERBOOK_GATEWAY_REDIS_CHANNEL = "rfq:gateway:events";

export class OrderbookStreamService {
  private readonly config: OrderbookStreamServiceConfig;
  private readonly now: () => Date;
  private readonly redisChannel: string;
  private readonly connectorsByVenue: ReadonlyMap<string, VenueOrderbookStreamConnector>;
  private readonly restRefreshersByVenue: ReadonlyMap<string, VenueOrderbookRestRefresher>;
  private readonly activeSubscriptions = new Map<string, { target: VenueOrderbookSubscriptionTarget; lastDesiredAt: number }>();
  private readonly lastRestRefreshBySubscription = new Map<string, number>();
  private lastSummaryLogAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(private readonly deps: OrderbookStreamServiceDeps) {
    this.config = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };
    this.now = deps.now ?? (() => new Date());
    this.redisChannel = deps.redisChannel ?? ORDERBOOK_GATEWAY_REDIS_CHANNEL;
    this.connectorsByVenue = new Map(deps.connectors.map((connector) => [normalizeVenue(connector.venue), connector]));
    this.restRefreshersByVenue = new Map((deps.restRefreshers ?? [])
      .map((refresher) => [normalizeVenue(refresher.venue), normalizeRestRefresher(refresher)]));
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
    this.activeSubscriptions.clear();
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
      const resolvedTargets = await this.resolveTargets(activeMarkets);
      const desiredTargets = resolvedTargets.filter((target) => this.connectorsByVenue.has(normalizeVenue(target.venue)));
      const desiredKeys = new Set(desiredTargets.map(subscriptionKey));
      const nowMs = this.now().getTime();
      for (const target of desiredTargets) {
        const key = subscriptionKey(target);
        const current = this.activeSubscriptions.get(key);
        if (current) {
          current.lastDesiredAt = nowMs;
        }
      }
      const staleKeys = [...this.activeSubscriptions.entries()]
        .filter(([key, record]) => !desiredKeys.has(key) && nowMs - record.lastDesiredAt >= this.config.subscriptionHoldMs)
        .map(([key]) => key)
        .slice(0, this.config.maxUnsubscribeTargetsPerTick);
      const retainedSubscriptions = [...this.activeSubscriptions.entries()]
        .filter(([key]) => !desiredKeys.has(key))
        .length - staleKeys.length;
      const newTargets = desiredTargets
        .filter((target) => !this.activeSubscriptions.has(subscriptionKey(target)))
        .slice(0, this.config.maxSubscribeTargetsPerTick);

      const unsubscribedKeys = await this.unsubscribe(staleKeys);
      const subscribedTargets = await this.subscribe(newTargets);

      for (const key of unsubscribedKeys) {
        this.activeSubscriptions.delete(key);
      }
      for (const target of subscribedTargets) {
        this.activeSubscriptions.set(subscriptionKey(target), { target, lastDesiredAt: nowMs });
      }
      const restRefreshed = await this.refreshRestTargets(desiredTargets, nowMs);

      const result = {
        activeMarkets: activeMarkets.length,
        desiredSubscriptions: desiredTargets.length,
        subscribed: subscribedTargets.length,
        unsubscribed: unsubscribedKeys.length,
        unsupportedVenueTargets: resolvedTargets.length - desiredTargets.length,
        retainedSubscriptions: Math.max(0, retainedSubscriptions),
        pendingSubscriptions: Math.max(0, desiredTargets.length - this.activeSubscriptions.size),
        restRefreshed
      };
      this.logSummary(result);
      return result;
    } catch (error) {
      this.deps.logger.warn({ err: error }, "Orderbook stream service tick failed.");
      return empty;
    } finally {
      this.running = false;
    }
  }

  private async resolveTargets(activeMarkets: readonly ActiveOrderbookMarket[]): Promise<readonly VenueOrderbookSubscriptionTarget[]> {
    const batchReadiness = await this.loadBatchReadiness(
      Math.max(activeMarkets.length, this.config.backgroundReadinessMarketLimit)
    );
    const activeTargetGroups: VenueOrderbookSubscriptionTarget[][] = [];
    for (const market of activeMarkets) {
      const readiness = batchReadiness
        ? batchReadiness.get(market.canonicalMarketId) ?? await this.loadSingleReadiness(market)
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
      activeTargetGroups.push(targets);
    }
    const activeTargets = dedupeTargetsBySubscription(activeTargetGroups.flat());
    const activeNativeKeys = new Set(activeTargets.map(nativeSubscriptionKey));
    const backgroundTargets = batchReadiness
      ? [...batchReadiness.entries()]
        .flatMap(([canonicalMarketId, readiness]) => readiness
          .filter(isQuoteReadyMapping)
          .map((row): VenueOrderbookSubscriptionTarget => ({
            canonicalMarketId,
            venue: normalizeVenue(row.venue),
            venueMarketId: row.venueMarketId!,
            ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
          })))
        .slice(0, this.config.maxBackgroundSubscriptionTargets)
      : [];
    const dedupedBackgroundTargets = dedupeTargetsByNative(backgroundTargets)
      .filter((target) => !activeNativeKeys.has(nativeSubscriptionKey(target)));
    return [...activeTargets, ...dedupedBackgroundTargets];
  }

  private async loadBatchReadiness(
    readinessLimit: number
  ): Promise<ReadonlyMap<string, readonly VenueQuoteMappingReadiness[]> | null> {
    if (!this.deps.mappingResolver.listApprovedReadiness) {
      return null;
    }
    const rows = await this.deps.mappingResolver.listApprovedReadiness({
      limit: Math.max(1, readinessLimit)
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

  private async subscribe(targets: readonly VenueOrderbookSubscriptionTarget[]): Promise<readonly VenueOrderbookSubscriptionTarget[]> {
    const grouped = groupByVenue(targets);
    const succeeded: VenueOrderbookSubscriptionTarget[] = [];
    await Promise.all([...grouped.entries()].map(async ([venue, venueTargets]) => {
      const connector = this.connectorsByVenue.get(venue);
      if (!connector) {
        return;
      }
      for (const chunk of chunks(venueTargets, this.config.maxTargetsPerConnectorCall)) {
        try {
          await connector.subscribe(chunk, (snapshot, target) => {
            this.onSnapshot(snapshot, target);
          });
          succeeded.push(...chunk);
        } catch (error) {
          this.deps.logger.warn({ err: error, venue, targetCount: chunk.length }, "Venue orderbook subscribe failed.");
        }
      }
    }));
    return succeeded;
  }

  private async unsubscribe(subscriptionKeys: readonly string[]): Promise<readonly string[]> {
    const keysByVenue = new Map<string, string[]>();
    for (const key of subscriptionKeys) {
      const venue = key.split("|", 1)[0] ?? "";
      const bucket = keysByVenue.get(venue) ?? [];
      bucket.push(key);
      keysByVenue.set(venue, bucket);
    }
    const succeeded: string[] = [];
    await Promise.all([...keysByVenue.entries()].map(async ([venue, keys]) => {
      const connector = this.connectorsByVenue.get(venue);
      if (!connector) {
        return;
      }
      for (const chunk of chunks(keys, this.config.maxTargetsPerConnectorCall)) {
        try {
          await connector.unsubscribe(chunk);
          succeeded.push(...chunk);
        } catch (error) {
          this.deps.logger.warn({ err: error, venue, targetCount: chunk.length }, "Venue orderbook unsubscribe failed.");
        }
      }
    }));
    return succeeded;
  }

  private async refreshRestTargets(
    targets: readonly VenueOrderbookSubscriptionTarget[],
    nowMs: number
  ): Promise<number> {
    const refreshable = dedupeTargetsBySubscription(targets)
      .filter((target) => this.isRestRefreshDue(target, nowMs))
      .filter(limitTargetsPerVenue(this.config.maxRestRefreshTargetsPerVenuePerTick))
      .slice(0, this.config.maxRestRefreshTargetsPerTick);
    if (refreshable.length === 0) {
      return 0;
    }

    let refreshed = 0;
    await Promise.all(refreshable.map(async (target) => {
      const refresher = this.restRefreshersByVenue.get(normalizeVenue(target.venue));
      if (!refresher) {
        return;
      }
      const key = subscriptionKey(target);
      this.lastRestRefreshBySubscription.set(key, nowMs);
      try {
        const snapshot = await withTimeout(
          refresher.refresh(target),
          this.config.restRefreshTimeoutMs,
          null
        );
        if (!snapshot) {
          return;
        }
        refreshed += 1;
        this.onSnapshot(snapshot, target);
      } catch (error) {
        this.deps.logger.warn(
          {
            err: error,
            venue: target.venue,
            venueMarketId: sanitizeIdentifier(target.venueMarketId),
            venueOutcomeId: target.venueOutcomeId ? sanitizeIdentifier(target.venueOutcomeId) : undefined
          },
          "Venue orderbook REST refresh failed."
        );
      }
    }));
    return refreshed;
  }

  private isRestRefreshDue(target: VenueOrderbookSubscriptionTarget, nowMs: number): boolean {
    if (!this.restRefreshersByVenue.has(normalizeVenue(target.venue))) {
      return false;
    }
    const last = this.lastRestRefreshBySubscription.get(subscriptionKey(target));
    return last === undefined || nowMs - last >= this.config.restRefreshIntervalMs;
  }

  private onSnapshot(snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget): void {
    this.deps.hotSnapshots.put(snapshot);
    void this.deps.liveOrderbooks?.put({
      canonicalMarketId: target.canonicalMarketId,
      ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
      snapshot
    }).catch((error) => {
      this.deps.logger.warn({ err: error, venue: snapshot.venue }, "Market orderbook live cache write failed.");
    });
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

  private logSummary(result: OrderbookStreamServiceRunResult): void {
    const nowMs = this.now().getTime();
    const hasChanges = result.subscribed > 0 || result.unsubscribed > 0 || result.pendingSubscriptions > 0;
    if (!hasChanges && nowMs - this.lastSummaryLogAt < this.config.summaryLogIntervalMs) {
      return;
    }
    this.lastSummaryLogAt = nowMs;
    this.deps.logger.info({
      ...result,
      activeSubscriptions: this.activeSubscriptions.size
    }, "Orderbook stream service tick completed.");
  }
}

export const marketOrderbookTopic = (canonicalMarketId: string, canonicalOutcomeId?: string | undefined): string =>
  `markets:orderbook:${topicPart(canonicalMarketId)}:${topicPart(canonicalOutcomeId ?? "_")}`;

export const parseMarketOrderbookTopic = (
  topic: string
): { canonicalMarketId: string; canonicalOutcomeId?: string | undefined } | null => {
  const parts = topic.split(":");
  if (parts.length !== 4 || parts[0] !== "markets" || parts[1] !== "orderbook") {
    return null;
  }
  const canonicalMarketId = decodeTopicPart(parts[2] ?? "");
  const canonicalOutcomeId = decodeTopicPart(parts[3] ?? "");
  if (!canonicalMarketId || canonicalOutcomeId === null) {
    return null;
  }
  return {
    canonicalMarketId,
    ...(canonicalOutcomeId !== "_" ? { canonicalOutcomeId } : {})
  };
};

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

const dedupeTargetsByNative = (targets: readonly VenueOrderbookSubscriptionTarget[]): readonly VenueOrderbookSubscriptionTarget[] => {
  const byKey = new Map<string, VenueOrderbookSubscriptionTarget>();
  for (const target of targets) {
    if (!byKey.has(nativeSubscriptionKey(target))) {
      byKey.set(nativeSubscriptionKey(target), target);
    }
  }
  return [...byKey.values()];
};

const dedupeTargetsBySubscription = (targets: readonly VenueOrderbookSubscriptionTarget[]): readonly VenueOrderbookSubscriptionTarget[] => {
  const byKey = new Map<string, VenueOrderbookSubscriptionTarget>();
  for (const target of targets) {
    if (!byKey.has(subscriptionKey(target))) {
      byKey.set(subscriptionKey(target), target);
    }
  }
  return [...byKey.values()];
};

const nativeSubscriptionKey = (target: VenueOrderbookSubscriptionTarget): string =>
  [
    normalizeVenue(target.venue),
    target.venueMarketId,
    target.venueOutcomeId ?? "_"
  ].join("|");

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

const limitTargetsPerVenue = (
  limit: number
): ((target: VenueOrderbookSubscriptionTarget) => boolean) => {
  const maxPerVenue = Math.max(1, Math.floor(limit));
  const counts = new Map<string, number>();
  return (target) => {
    const venue = normalizeVenue(target.venue);
    const count = counts.get(venue) ?? 0;
    if (count >= maxPerVenue) {
      return false;
    }
    counts.set(venue, count + 1);
    return true;
  };
};

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const chunkSize = Math.max(1, size);
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    result.push(values.slice(index, index + chunkSize));
  }
  return result;
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

const decodeTopicPart = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};

const sanitizeStrings = (values: readonly string[]): readonly string[] =>
  values
    .map((value) => value.replace(/[A-Za-z0-9_-]{32,}/g, "REDACTED").slice(0, 120))
    .filter((value) => value.trim().length > 0);

const sanitizeIdentifier = (value: string): string =>
  value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;

const normalizeRestRefresher = (
  refresher: VenueOrderbookRestRefresher | VenueQuoteSnapshotReader
): VenueOrderbookRestRefresher => {
  if ("refresh" in refresher) {
    return refresher;
  }
  return {
    venue: refresher.venue,
    refresh: (target) => refresher.getQuoteSnapshot({
      canonicalMarketId: target.canonicalMarketId,
      ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
      venueMarketId: target.venueMarketId,
      ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
      side: "buy",
      quantity: 1
    })
  };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const emptyResult = (): OrderbookStreamServiceRunResult => ({
  activeMarkets: 0,
  desiredSubscriptions: 0,
  subscribed: 0,
  unsubscribed: 0,
  unsupportedVenueTargets: 0,
  retainedSubscriptions: 0,
  pendingSubscriptions: 0,
  restRefreshed: 0
});
