import type { Logger } from "pino";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type {
  NormalizedVenueQuoteSnapshot,
  NormalizedQuoteLevel,
  SharedCoreQuoteReadinessMarket,
  VenueQuoteSnapshotReader,
  VenueQuoteMappingReadiness,
  VenueQuoteMappingResolver
} from "../core/sor/quote-snapshot.js";
import type { RedisClient } from "../db/redis.js";
import type { VenueOrderbookSnapshotInput, VenueOrderbookSnapshotRepository } from "../repositories/venue-orderbook-snapshot.repository.js";
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

interface OrderbookReadinessGroup {
  venues: readonly VenueQuoteMappingReadiness[];
  outcomeVenues?: readonly VenueQuoteMappingReadiness[] | undefined;
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
  restRefreshFailureCooldownMs: number;
  restRefreshVenuePolicies: Readonly<Record<string, OrderbookStreamVenueRestPolicy>>;
  latestSnapshotPersistIntervalMs: number;
  latestSnapshotPersistMinSpacingMs: number;
  summaryLogIntervalMs: number;
}

export interface OrderbookStreamVenueRestPolicy {
  maxTargetsPerSweep?: number | undefined;
  failureCooldownMs?: number | undefined;
  timeoutMs?: number | undefined;
}

interface PublishedOrderbookSideDeltas {
  changed: readonly NormalizedQuoteLevel[];
  removed: readonly NormalizedQuoteLevel[];
}

interface PublishedOrderbookDeltas {
  bids: PublishedOrderbookSideDeltas;
  asks: PublishedOrderbookSideDeltas;
}

interface PublishedOrderbookLevels {
  bids: readonly NormalizedQuoteLevel[];
  asks: readonly NormalizedQuoteLevel[];
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
  latestSnapshots?: Pick<VenueOrderbookSnapshotRepository, "upsertLatestMany"> | undefined;
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
  restRefreshedByVenue: Readonly<Record<string, number>>;
}

const DEFAULT_CONFIG: OrderbookStreamServiceConfig = {
  pollIntervalMs: 1_000,
  activeMarketLimit: 1_000,
  backgroundReadinessMarketLimit: 2_500,
  maxBackgroundSubscriptionTargets: 1_200,
  maxSubscribeTargetsPerTick: 360,
  maxUnsubscribeTargetsPerTick: 40,
  maxTargetsPerConnectorCall: 75,
  subscriptionHoldMs: 120_000,
  restRefreshIntervalMs: 10_000,
  maxRestRefreshTargetsPerTick: 240,
  maxRestRefreshTargetsPerVenuePerTick: 64,
  restRefreshTimeoutMs: 2_000,
  restRefreshFailureCooldownMs: 60_000,
  restRefreshVenuePolicies: {
    POLYMARKET: { maxTargetsPerSweep: 128, failureCooldownMs: 60_000, timeoutMs: 2_000 },
    LIMITLESS: { maxTargetsPerSweep: 3, failureCooldownMs: 300_000, timeoutMs: 2_500 },
    PREDICT_FUN: { maxTargetsPerSweep: 18, failureCooldownMs: 90_000, timeoutMs: 2_000 },
    OPINION: { maxTargetsPerSweep: 8, failureCooldownMs: 180_000, timeoutMs: 6_000 }
  },
  latestSnapshotPersistIntervalMs: 30_000,
  latestSnapshotPersistMinSpacingMs: 250,
  summaryLogIntervalMs: 15_000
};

const REST_REFRESH_HARD_TARGET_COOLDOWN_MS = 30 * 60_000;

export const ORDERBOOK_GATEWAY_REDIS_CHANNEL = "rfq:gateway:events";
export const ORDERBOOK_STREAM_SCHEMA_VERSION = "lotus-orderbook-stream-v2";

export class OrderbookStreamService {
  private readonly config: OrderbookStreamServiceConfig;
  private readonly now: () => Date;
  private readonly redisChannel: string;
  private readonly connectorsByVenue: ReadonlyMap<string, VenueOrderbookStreamConnector>;
  private readonly restRefreshersByVenue: ReadonlyMap<string, VenueOrderbookRestRefresher>;
  private readonly activeSubscriptions = new Map<string, { target: VenueOrderbookSubscriptionTarget; lastDesiredAt: number }>();
  private readonly lastRestRefreshBySubscription = new Map<string, number>();
  private readonly restRefreshFailureCooldowns = new Map<string, number>();
  private readonly restRefreshVenueFailureCooldowns = new Map<string, number>();
  private readonly lastLatestSnapshotPersistBySubscription = new Map<string, number>();
  private readonly sequenceByTopic = new Map<string, number>();
  private readonly lastPublishedLevelsBySubscription = new Map<string, PublishedOrderbookLevels>();
  private backgroundTargetCursor = 0;
  private restRefreshTargetCursor = 0;
  private lastLatestSnapshotPersistAt = 0;
  private lastRestRefreshSweepAt = 0;
  private lastSummaryLogAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(private readonly deps: OrderbookStreamServiceDeps) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...(deps.config ?? {}),
      restRefreshVenuePolicies: {
        ...DEFAULT_CONFIG.restRefreshVenuePolicies,
        ...(deps.config?.restRefreshVenuePolicies ?? {})
      }
    };
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
        venues: [...this.connectorsByVenue.keys()].sort(),
        restRefreshIntervalMs: this.config.restRefreshIntervalMs,
        restRefreshVenuePolicies: this.config.restRefreshVenuePolicies
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
      const restRefresh = await this.refreshRestTargets(desiredTargets, nowMs, subscribedTargets);

      const result = {
        activeMarkets: activeMarkets.length,
        desiredSubscriptions: desiredTargets.length,
        subscribed: subscribedTargets.length,
        unsubscribed: unsubscribedKeys.length,
        unsupportedVenueTargets: resolvedTargets.length - desiredTargets.length,
        retainedSubscriptions: Math.max(0, retainedSubscriptions),
        pendingSubscriptions: Math.max(0, desiredTargets.length - this.activeSubscriptions.size),
        restRefreshed: restRefresh.total,
        restRefreshedByVenue: restRefresh.byVenue
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
      const targets = activeReadinessRowsForMarket(market, readiness)
        .filter(isWarmableMapping)
        .map((row): VenueOrderbookSubscriptionTarget => targetFromReadinessRow(market.canonicalMarketId, market.canonicalOutcomeId, row));
      activeTargetGroups.push(targets);
    }
    const activeTargets = dedupeTargetsBySubscription(activeTargetGroups.flat());
    const activeNativeKeys = new Set(activeTargets.map(nativeSubscriptionKey));
    const backgroundTargetLimit = Math.max(
      0,
      this.config.maxBackgroundSubscriptionTargets - activeTargets.length
    );
    const backgroundCandidates = batchReadiness
      ? [...batchReadiness.entries()]
        .flatMap(([canonicalMarketId, readiness]) => (
          readiness.outcomeVenues && readiness.outcomeVenues.length > 0
            ? readiness.outcomeVenues
            : readiness.venues
        )
          .filter(isWarmableMapping)
          .map((row): VenueOrderbookSubscriptionTarget => ({
            canonicalMarketId,
            ...(row.canonicalOutcomeId ? { canonicalOutcomeId: row.canonicalOutcomeId } : {}),
            venue: normalizeVenue(row.venue),
            venueMarketId: row.venueMarketId!,
            ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
          })))
      : [];
    const dedupedBackgroundTargets = dedupeTargetsByNative(backgroundCandidates)
      .filter((target) => !activeNativeKeys.has(nativeSubscriptionKey(target)));
    const selectedBackgroundTargets = selectBalancedBackgroundTargets(
      dedupedBackgroundTargets,
      backgroundTargetLimit,
      this.backgroundTargetCursor
    );
    this.backgroundTargetCursor += 1;
    return [...activeTargets, ...selectedBackgroundTargets];
  }

  private async loadBatchReadiness(
    readinessLimit: number
  ): Promise<ReadonlyMap<string, OrderbookReadinessGroup> | null> {
    if (!this.deps.mappingResolver.listApprovedReadiness) {
      return null;
    }
    const rows = await this.deps.mappingResolver.listApprovedReadiness({
      limit: Math.max(1, readinessLimit)
    });
    return readinessByCanonicalMarket(rows);
  }

  private async loadSingleReadiness(market: ActiveOrderbookMarket): Promise<OrderbookReadinessGroup> {
    if (!this.deps.mappingResolver.getReadiness) {
      return { venues: [] };
    }
    return {
      venues: await this.deps.mappingResolver.getReadiness({
        canonicalMarketId: market.canonicalMarketId,
        ...(market.canonicalOutcomeId ? { canonicalOutcomeId: market.canonicalOutcomeId } : {})
      })
    };
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
    nowMs: number,
    immediateTargets: readonly VenueOrderbookSubscriptionTarget[] = []
  ): Promise<{ total: number; byVenue: Readonly<Record<string, number>> }> {
    const immediateNativeKeys = new Set(immediateTargets.map(nativeSubscriptionKey));
    const sweepDue = this.lastRestRefreshSweepAt <= 0 || nowMs - this.lastRestRefreshSweepAt >= this.config.restRefreshIntervalMs;
    if (!sweepDue && immediateNativeKeys.size === 0) {
      return emptyRestRefreshResult();
    }
    if (sweepDue) {
      this.lastRestRefreshSweepAt = nowMs;
    }
    const groupsByNative = groupTargetsByNative(dedupeTargetsBySubscription(targets));
    const refreshableCandidates = [...groupsByNative.values()]
      .flatMap((group) => group[0] ? [group[0]] : [])
      .filter((target) => sweepDue || immediateNativeKeys.has(nativeSubscriptionKey(target)))
      .filter((target) => this.isRestRefreshDue(target, nowMs))
      .filter((target) => !this.isRestRefreshFailureCoolingDown(target, nowMs));
    const refreshable = selectRestRefreshTargets(
      refreshableCandidates,
      this.config.maxRestRefreshTargetsPerTick,
      this.config.maxRestRefreshTargetsPerVenuePerTick,
      this.config.restRefreshVenuePolicies,
      this.restRefreshTargetCursor
    );
    this.restRefreshTargetCursor += 1;
    if (refreshable.length === 0) {
      return emptyRestRefreshResult();
    }

    let refreshed = 0;
    const refreshedByVenue: Record<string, number> = {};
    const refreshableByVenue = groupByVenue(refreshable);
    await Promise.all([...refreshableByVenue.values()].map(async (venueTargets) => {
      for (const target of venueTargets) {
        if (this.isRestRefreshFailureCoolingDown(target, nowMs)) {
          continue;
        }
        const refresher = this.restRefreshersByVenue.get(normalizeVenue(target.venue));
        if (!refresher) {
          continue;
        }
        const key = restRefreshKey(target);
        const fanoutTargets = groupsByNative.get(nativeSubscriptionKey(target)) ?? [target];
        this.lastRestRefreshBySubscription.set(key, nowMs);
        try {
          const snapshot = await withTimeout(
            refresher.refresh(target),
            this.restRefreshTimeoutMsFor(target),
            null
          );
          if (!snapshot) {
            this.markRestRefreshFailure(target, nowMs, "target");
            continue;
          }
          refreshed += 1;
          const venue = normalizeVenue(target.venue);
          refreshedByVenue[venue] = (refreshedByVenue[venue] ?? 0) + 1;
          for (const fanoutTarget of fanoutTargets) {
            this.onSnapshot(snapshot, fanoutTarget);
          }
          if (isBlockedNoDepthSnapshot(snapshot)) {
            this.markRestRefreshFailure(target, nowMs, "target");
          } else {
            this.restRefreshFailureCooldowns.delete(key);
          }
        } catch (error) {
          const hardBlockedSnapshot = restRefreshHardBlockedSnapshot(target, error, this.now());
          if (hardBlockedSnapshot) {
            this.onSnapshot(hardBlockedSnapshot, target);
          }
          this.markRestRefreshFailure(
            target,
            nowMs,
            restRefreshFailureScope(error),
            hardBlockedSnapshot ? REST_REFRESH_HARD_TARGET_COOLDOWN_MS : undefined
          );
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
      }
    }));
    return { total: refreshed, byVenue: refreshedByVenue };
  }

  private isRestRefreshDue(target: VenueOrderbookSubscriptionTarget, nowMs: number): boolean {
    if (!this.restRefreshersByVenue.has(normalizeVenue(target.venue))) {
      return false;
    }
    const last = this.lastRestRefreshBySubscription.get(restRefreshKey(target));
    return last === undefined || nowMs - last >= this.config.restRefreshIntervalMs;
  }

  private isRestRefreshFailureCoolingDown(target: VenueOrderbookSubscriptionTarget, nowMs: number): boolean {
    const until = this.restRefreshFailureCooldowns.get(restRefreshKey(target));
    const venueUntil = this.restRefreshVenueFailureCooldowns.get(normalizeVenue(target.venue));
    return (until !== undefined && until > nowMs) || (venueUntil !== undefined && venueUntil > nowMs);
  }

  private markRestRefreshFailure(
    target: VenueOrderbookSubscriptionTarget,
    nowMs: number,
    scope: "target" | "venue",
    cooldownMsOverride?: number | undefined
  ): void {
    const cooldownMs = cooldownMsOverride ?? this.restRefreshFailureCooldownMsFor(target);
    this.restRefreshFailureCooldowns.set(
      restRefreshKey(target),
      nowMs + cooldownMs
    );
    if (scope === "venue") {
      this.restRefreshVenueFailureCooldowns.set(
        normalizeVenue(target.venue),
        nowMs + cooldownMs
      );
    }
  }

  private restRefreshFailureCooldownMsFor(target: VenueOrderbookSubscriptionTarget): number {
    const venue = normalizeVenue(target.venue);
    const venuePolicy = this.config.restRefreshVenuePolicies[venue];
    return Math.max(
      1_000,
      Math.floor(venuePolicy?.failureCooldownMs ?? this.config.restRefreshFailureCooldownMs)
    );
  }

  private restRefreshTimeoutMsFor(target: VenueOrderbookSubscriptionTarget): number {
    const venue = normalizeVenue(target.venue);
    const venuePolicy = this.config.restRefreshVenuePolicies[venue];
    return Math.max(
      250,
      Math.floor(venuePolicy?.timeoutMs ?? this.config.restRefreshTimeoutMs)
    );
  }

  private onSnapshot(snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget): void {
    const targetSnapshot = snapshotForTargetLookup(snapshot, target);
    this.deps.hotSnapshots.put(targetSnapshot);
    void this.deps.liveOrderbooks?.put({
      canonicalMarketId: target.canonicalMarketId,
      ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
      snapshot: targetSnapshot
    }).catch((error) => {
      this.deps.logger.warn({ err: error, venue: snapshot.venue }, "Market orderbook live cache write failed.");
    });
    void this.publishMarketUpdate(targetSnapshot, target);
    void this.persistLatestSnapshot(targetSnapshot, target).catch((error) => {
      this.deps.logger.warn({ err: error, venue: snapshot.venue }, "Orderbook stream latest snapshot persist failed.");
    });
  }

  private async persistLatestSnapshot(
    snapshot: NormalizedVenueQuoteSnapshot,
    target: VenueOrderbookSubscriptionTarget
  ): Promise<void> {
    if (!this.deps.latestSnapshots) {
      return;
    }
    const key = subscriptionKey(target);
    const nowMs = this.now().getTime();
    const lastPersistedAt = this.lastLatestSnapshotPersistBySubscription.get(key) ?? 0;
    if (nowMs - lastPersistedAt < this.config.latestSnapshotPersistIntervalMs) {
      return;
    }
    if (nowMs - this.lastLatestSnapshotPersistAt < this.config.latestSnapshotPersistMinSpacingMs) {
      return;
    }
    this.lastLatestSnapshotPersistAt = nowMs;
    this.lastLatestSnapshotPersistBySubscription.set(key, nowMs);
    await this.deps.latestSnapshots.upsertLatestMany([toLatestSnapshotInput({
      canonicalMarketId: target.canonicalMarketId,
      canonicalOutcomeId: target.canonicalOutcomeId ?? null,
      snapshot,
      receivedAt: this.now()
    })]);
  }

  private async publishMarketUpdate(
    snapshot: NormalizedVenueQuoteSnapshot,
    target: VenueOrderbookSubscriptionTarget
  ): Promise<void> {
    const topic = marketOrderbookTopic(target.canonicalMarketId, target.canonicalOutcomeId);
    const bestBid = snapshot.bids[0]?.price ?? null;
    const bestAsk = snapshot.asks[0]?.price ?? null;
    const blockers = sanitizeStrings(snapshot.blockers ?? []);
    const bids = snapshot.bids.slice(0, 5);
    const asks = snapshot.asks.slice(0, 5);
    const publishKey = subscriptionKey(target);
    const previousLevels = this.lastPublishedLevelsBySubscription.get(publishKey);
    const deltas = previousLevels
      ? calculatePublishedOrderbookDeltas(previousLevels, { bids, asks })
      : null;
    const requiresFullBook = !previousLevels || blockers.length > 0;
    this.lastPublishedLevelsBySubscription.set(publishKey, { bids, asks });
    const event = {
      type: "MARKET_ORDERBOOK_UPDATE",
      topic,
      emittedAt: this.now().toISOString(),
      payload: {
        schemaVersion: ORDERBOOK_STREAM_SCHEMA_VERSION,
        updateType: requiresFullBook ? "snapshot" : "delta",
        seq: this.nextSequence(topic),
        canonicalMarketId: target.canonicalMarketId,
        canonicalOutcomeId: target.canonicalOutcomeId ?? null,
        venue: normalizeVenue(snapshot.venue),
        venueMarketId: snapshot.venueMarketId,
        venueOutcomeId: snapshot.venueOutcomeId ?? null,
        source: "stream",
        quoteQuality: snapshot.quoteQuality,
        bestBid,
        bestAsk,
        midpoint: calculateMidpoint(bestBid, bestAsk),
        spread: calculateSpread(bestBid, bestAsk),
        bidSize: snapshot.bids[0]?.size ?? null,
        askSize: snapshot.asks[0]?.size ?? null,
        freshnessMs: Math.max(0, this.now().getTime() - snapshot.receivedAt.getTime()),
        snapshotStatus: blockers.length > 0 ? "blocked" : "live",
        venueCount: 1,
        liveVenueCount: blockers.length > 0 || (!bestBid && !bestAsk) ? 0 : 1,
        blockers,
        ...(requiresFullBook ? { bids, asks } : {
          bidDeltas: encodePublishedOrderbookDeltas(deltas?.bids),
          askDeltas: encodePublishedOrderbookDeltas(deltas?.asks)
        }),
        checksum: calculateOrderbookStreamChecksum({
          canonicalMarketId: target.canonicalMarketId,
          canonicalOutcomeId: target.canonicalOutcomeId ?? null,
          venue: normalizeVenue(snapshot.venue),
          bestBid,
          bestAsk,
          bids,
          asks,
          blockers
        })
      }
    };
    try {
      await this.deps.publisher.publish(this.redisChannel, JSON.stringify(event));
    } catch (error) {
      this.deps.logger.warn({ err: error, venue: snapshot.venue }, "Orderbook stream gateway publish failed.");
    }
  }

  private nextSequence(topic: string): number {
    const next = (this.sequenceByTopic.get(topic) ?? 0) + 1;
    this.sequenceByTopic.set(topic, next);
    return next;
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

const isWarmableMapping = (
  row: VenueQuoteMappingReadiness
): row is VenueQuoteMappingReadiness & { venueMarketId: string } =>
  row.venueMarketId !== null &&
  hasRequiredNativeSubscriptionId(row) &&
  !hasHardUnavailableBlocker(row);

const hasRequiredNativeSubscriptionId = (row: VenueQuoteMappingReadiness): boolean => {
  const venue = normalizeVenue(row.venue);
  return venue !== "POLYMARKET" || Boolean(row.venueOutcomeId);
};

const hasHardUnavailableBlocker = (row: VenueQuoteMappingReadiness): boolean =>
  row.blockers.some((blocker) =>
    /OFFICIAL_MARKET_CLOSED|NOT_ACCEPTING_ORDERS|QUOTE_PROVIDER_HTTP_404|PROVIDER_UNAVAILABLE_404|MARKET_CLOSED/i.test(blocker)
  );

const activeReadinessRowsForMarket = (
  market: ActiveOrderbookMarket,
  readiness: OrderbookReadinessGroup
): readonly VenueQuoteMappingReadiness[] => {
  const outcomeRows = readiness.outcomeVenues ?? [];
  if (outcomeRows.length === 0) {
    return readiness.venues;
  }

  if (market.canonicalOutcomeId) {
    const wantedOutcomeId = normalizeOutcomeId(market.canonicalOutcomeId);
    const matchingOutcomeRows = outcomeRows.filter((row) =>
      normalizeOutcomeId(row.canonicalOutcomeId) === wantedOutcomeId
    );
    return matchingOutcomeRows.length > 0
      ? matchingOutcomeRows
      : readiness.venues;
  }

  const yesOutcomeRows = outcomeRows.filter((row) => normalizeOutcomeId(row.canonicalOutcomeId) === "YES");
  const displayOutcomeRows = yesOutcomeRows.length > 0 ? yesOutcomeRows : outcomeRows;
  return displayOutcomeRows.length > 0 ? displayOutcomeRows : readiness.venues;
};

const targetFromReadinessRow = (
  canonicalMarketId: string,
  requestedOutcomeId: string | undefined,
  row: VenueQuoteMappingReadiness & { venueMarketId: string }
): VenueOrderbookSubscriptionTarget => {
  const canonicalOutcomeId = row.canonicalOutcomeId ?? requestedOutcomeId;
  return {
    canonicalMarketId,
    ...(canonicalOutcomeId ? { canonicalOutcomeId } : {}),
    venue: normalizeVenue(row.venue),
    venueMarketId: row.venueMarketId,
    ...(row.venueOutcomeId ? { venueOutcomeId: row.venueOutcomeId } : {})
  };
};

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

const groupTargetsByNative = (
  targets: readonly VenueOrderbookSubscriptionTarget[]
): ReadonlyMap<string, readonly VenueOrderbookSubscriptionTarget[]> => {
  const grouped = new Map<string, VenueOrderbookSubscriptionTarget[]>();
  for (const target of targets) {
    const key = nativeSubscriptionKey(target);
    const bucket = grouped.get(key) ?? [];
    bucket.push(target);
    grouped.set(key, bucket);
  }
  return grouped;
};

const selectBalancedBackgroundTargets = (
  targets: readonly VenueOrderbookSubscriptionTarget[],
  limit: number,
  cursor: number
): readonly VenueOrderbookSubscriptionTarget[] => {
  const maxTargets = Math.max(0, Math.floor(limit));
  if (targets.length <= maxTargets) {
    return targets;
  }
  if (maxTargets === 0) {
    return [];
  }
  const grouped = groupByVenue(targets);
  const venues = [...grouped.keys()].sort(venuePriorityCompare);
  const rotatedByVenue = new Map<string, VenueOrderbookSubscriptionTarget[]>();
  for (const venue of venues) {
    const venueTargets = grouped.get(venue) ?? [];
    rotatedByVenue.set(venue, rotate(venueTargets, cursor));
  }

  const selected: VenueOrderbookSubscriptionTarget[] = [];
  let round = 0;
  while (selected.length < maxTargets) {
    let added = false;
    for (const venue of venues) {
      const target = rotatedByVenue.get(venue)?.[round];
      if (!target) {
        continue;
      }
      selected.push(target);
      added = true;
      if (selected.length >= maxTargets) {
        break;
      }
    }
    if (!added) {
      break;
    }
    round += 1;
  }
  return selected;
};

const VENUE_BACKGROUND_PRIORITY = new Map([
  ["POLYMARKET", 0],
  ["OPINION", 1],
  ["PREDICT_FUN", 2],
  ["LIMITLESS", 3]
]);

const venuePriorityCompare = (left: string, right: string): number =>
  (VENUE_BACKGROUND_PRIORITY.get(left) ?? 100) - (VENUE_BACKGROUND_PRIORITY.get(right) ?? 100)
  || left.localeCompare(right);

const isBlockedNoDepthSnapshot = (snapshot: NormalizedVenueQuoteSnapshot): boolean =>
  (snapshot.blockers ?? []).length > 0 &&
  snapshot.bids.length === 0 &&
  snapshot.asks.length === 0;

const restRefreshFailureScope = (error: unknown): "target" | "venue" => {
  const status = errorStatus(error);
  if (status !== null) {
    if (status === 400 || status === 404 || status === 410) {
      return "target";
    }
    if (status === 429 || status >= 500) {
      return "venue";
    }
  }
  const message = errorMessage(error);
  if (/market is not active|not accepting orders|market closed|orderbook request failed with status 404/i.test(message)) {
    return "target";
  }
  if (/timeout|timed out|\b429\b|\b5\d\d\b|rate limit|too many requests/i.test(message)) {
    return "venue";
  }
  return "target";
};

const restRefreshHardBlockedSnapshot = (
  target: VenueOrderbookSubscriptionTarget,
  error: unknown,
  receivedAt: Date
): NormalizedVenueQuoteSnapshot | null => {
  const blockers = restRefreshHardBlockers(error);
  if (blockers.length === 0) {
    return null;
  }
  return {
    venue: normalizeVenue(target.venue),
    venueMarketId: target.venueMarketId,
    ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
    source: "REST",
    quoteQuality: "DIAGNOSTIC_ONLY",
    sourceTimestamp: null,
    receivedAt,
    bids: [],
    asks: [],
    missingFactors: ["ORDERBOOK_DEPTH"],
    blockers,
    streamResynced: true,
    metadata: {
      displayOnly: true,
      restFailure: true,
      venueMarketId: target.venueMarketId,
      venueOutcomeId: target.venueOutcomeId ?? null
    }
  };
};

const restRefreshHardBlockers = (error: unknown): readonly string[] => {
  const status = errorStatus(error);
  const message = errorMessage(error);
  if (status === 404 || status === 410) {
    return ["QUOTE_PROVIDER_HTTP_404"];
  }
  if (
    status === 400 &&
    /market is not active|not accepting orders|market closed|not found/i.test(message)
  ) {
    return ["QUOTE_PROVIDER_MARKET_INACTIVE"];
  }
  if (/market is not active|not accepting orders|market closed/i.test(message)) {
    return ["QUOTE_PROVIDER_MARKET_INACTIVE"];
  }
  return [];
};

const errorStatus = (error: unknown): number | null => {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  if (typeof record.status === "number" && Number.isInteger(record.status)) {
    return record.status;
  }
  const message = errorMessage(error);
  const match = message.match(/\bstatus\s+(\d{3})\b/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  return [
    typeof record.name === "string" ? record.name : "",
    typeof record.message === "string" ? record.message : "",
    typeof record.code === "string" || typeof record.code === "number" ? String(record.code) : ""
  ].filter(Boolean).join(" ");
};

const rotate = <T>(values: readonly T[], cursor: number): T[] => {
  if (values.length <= 1) {
    return [...values];
  }
  const offset = Math.abs(cursor) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
};

const restRefreshKey = (target: VenueOrderbookSubscriptionTarget): string =>
  nativeSubscriptionKey(target);

const selectRestRefreshTargets = (
  targets: readonly VenueOrderbookSubscriptionTarget[],
  totalLimit: number,
  defaultPerVenueLimit: number,
  venuePolicies: Readonly<Record<string, OrderbookStreamVenueRestPolicy>>,
  cursor: number
): readonly VenueOrderbookSubscriptionTarget[] => {
  const maxTargets = Math.max(0, Math.floor(totalLimit));
  if (maxTargets === 0 || targets.length === 0) {
    return [];
  }
  const grouped = groupByVenue(targets);
  const venues = [...grouped.keys()].sort(venuePriorityCompare);
  const perVenueLimit = (venue: string): number => {
    const configuredLimit = venuePolicies[venue]?.maxTargetsPerSweep;
    return Math.max(0, Math.floor(configuredLimit ?? defaultPerVenueLimit));
  };
  const rotatedByVenue = new Map<string, VenueOrderbookSubscriptionTarget[]>();
  const countsByVenue = new Map<string, number>();
  for (const venue of venues) {
    const venueLimit = perVenueLimit(venue);
    if (venueLimit === 0) {
      continue;
    }
    const venueTargets = grouped.get(venue) ?? [];
    const pageOffset = venueTargets.length <= 1 ? 0 : (Math.abs(cursor) * venueLimit) % venueTargets.length;
    rotatedByVenue.set(venue, rotate(venueTargets, pageOffset));
    countsByVenue.set(venue, 0);
  }

  const selected: VenueOrderbookSubscriptionTarget[] = [];
  let round = 0;
  while (selected.length < maxTargets) {
    let added = false;
    for (const venue of venues) {
      const venueTargets = rotatedByVenue.get(venue);
      if (!venueTargets) {
        continue;
      }
      const venueLimit = perVenueLimit(venue);
      const venueCount = countsByVenue.get(venue) ?? 0;
      if (venueCount >= venueLimit) {
        continue;
      }
      const target = venueTargets[round];
      if (!target) {
        continue;
      }
      selected.push(target);
      countsByVenue.set(venue, venueCount + 1);
      added = true;
      if (selected.length >= maxTargets) {
        break;
      }
    }
    if (!added) {
      break;
    }
    round += 1;
  }
  return selected;
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
): ReadonlyMap<string, OrderbookReadinessGroup> => {
  const byMarket = new Map<string, {
    venues: VenueQuoteMappingReadiness[];
    outcomeVenues: VenueQuoteMappingReadiness[];
  }>();
  for (const row of rows) {
    const marketIds = row.canonicalMarketIds.length > 0
      ? row.canonicalMarketIds
      : [row.canonicalEventId];
    for (const marketId of marketIds) {
      const bucket = byMarket.get(marketId) ?? { venues: [], outcomeVenues: [] };
      bucket.venues.push(...row.venues);
      if (row.outcomeVenues && row.outcomeVenues.length > 0) {
        bucket.outcomeVenues.push(...row.outcomeVenues);
      }
      byMarket.set(marketId, bucket);
    }
  }
  return new Map([...byMarket.entries()].map(([marketId, bucket]) => [
    marketId,
    {
      venues: bucket.venues,
      ...(bucket.outcomeVenues.length > 0 ? { outcomeVenues: bucket.outcomeVenues } : {})
    }
  ]));
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

const snapshotForTargetLookup = (
  snapshot: NormalizedVenueQuoteSnapshot,
  target: VenueOrderbookSubscriptionTarget
): NormalizedVenueQuoteSnapshot => {
  const targetVenueMarketId = target.venueMarketId;
  const targetVenueOutcomeId = target.venueOutcomeId;
  if (snapshot.venueMarketId === targetVenueMarketId && snapshot.venueOutcomeId === targetVenueOutcomeId) {
    return snapshot;
  }

  const { venueOutcomeId: nativeVenueOutcomeId, ...snapshotWithoutOutcome } = snapshot;
  return {
    ...snapshotWithoutOutcome,
    venueMarketId: targetVenueMarketId,
    ...(targetVenueOutcomeId ? { venueOutcomeId: targetVenueOutcomeId } : {}),
    metadata: {
      ...(snapshot.metadata ?? {}),
      nativeVenueMarketId: snapshot.venueMarketId,
      nativeVenueOutcomeId: nativeVenueOutcomeId ?? null,
      approvedVenueMarketId: targetVenueMarketId,
      approvedVenueOutcomeId: targetVenueOutcomeId ?? null
    }
  };
};

const normalizeOutcomeId = (outcomeId: string | null | undefined): string =>
  (outcomeId ?? "").trim().toUpperCase();

const sanitizeStrings = (values: readonly string[]): readonly string[] =>
  values
    .map((value) => value.replace(/[A-Za-z0-9_-]{32,}/g, "REDACTED").slice(0, 120))
    .filter((value) => value.trim().length > 0);

const toLatestSnapshotInput = (input: {
  canonicalMarketId: string;
  canonicalOutcomeId: string | null;
  snapshot: NormalizedVenueQuoteSnapshot;
  receivedAt: Date;
}): VenueOrderbookSnapshotInput => {
  const bestBid = input.snapshot.bids[0]?.price ?? null;
  const bestAsk = input.snapshot.asks[0]?.price ?? null;
  const midpoint = calculateMidpoint(bestBid, bestAsk);
  return {
    canonicalEventId: input.canonicalMarketId,
    canonicalMarketId: input.canonicalMarketId,
    canonicalOutcomeId: input.canonicalOutcomeId,
    venue: normalizeVenue(input.snapshot.venue),
    venueMarketId: input.snapshot.venueMarketId,
    venueOutcomeId: input.snapshot.venueOutcomeId ?? null,
    source: input.snapshot.source,
    quoteQuality: input.snapshot.quoteQuality,
    sourceTimestamp: input.snapshot.sourceTimestamp,
    receivedAt: input.receivedAt,
    bestBid,
    bestAsk,
    midpoint,
    spread: calculateSpread(bestBid, bestAsk),
    bidDepth: sumLevels(input.snapshot.bids),
    askDepth: sumLevels(input.snapshot.asks),
    bids: input.snapshot.bids.slice(0, 25),
    asks: input.snapshot.asks.slice(0, 25),
    blockers: sanitizeStrings(input.snapshot.blockers ?? []),
    metadataVersion: "orderbook-stream-latest-v1"
  };
};

const calculateMidpoint = (bestBid: string | null, bestAsk: string | null): string | null => {
  if (!bestBid || !bestAsk) {
    return bestBid ?? bestAsk;
  }
  try {
    return new Decimal(bestBid).plus(bestAsk).div(2).toFixed(6);
  } catch {
    return bestBid ?? bestAsk;
  }
};

const calculateSpread = (bestBid: string | null, bestAsk: string | null): string | null => {
  if (!bestBid || !bestAsk) {
    return null;
  }
  try {
    return Decimal.max(0, new Decimal(bestAsk).minus(bestBid)).toFixed(6);
  } catch {
    return null;
  }
};

const sumLevels = (levels: readonly NormalizedQuoteLevel[]): string => {
  try {
    return levels.reduce((sum, level) => sum.plus(level.size), new Decimal(0)).toFixed(6);
  } catch {
    return "0";
  }
};

const calculatePublishedOrderbookDeltas = (
  previous: PublishedOrderbookLevels,
  current: PublishedOrderbookLevels
): PublishedOrderbookDeltas => ({
  bids: calculatePublishedSideDeltas(previous.bids, current.bids),
  asks: calculatePublishedSideDeltas(previous.asks, current.asks)
});

const calculatePublishedSideDeltas = (
  previous: readonly NormalizedQuoteLevel[],
  current: readonly NormalizedQuoteLevel[]
): PublishedOrderbookSideDeltas => {
  const previousByPrice = new Map(previous.map((level) => [level.price, level]));
  const currentByPrice = new Map(current.map((level) => [level.price, level]));
  const changed = current.filter((level) => previousByPrice.get(level.price)?.size !== level.size);
  const removed = previous
    .filter((level) => !currentByPrice.has(level.price))
    .map((level) => ({ price: level.price, size: "0" }));
  return { changed, removed };
};

const encodePublishedOrderbookDeltas = (
  deltas: PublishedOrderbookSideDeltas | undefined
): readonly NormalizedQuoteLevel[] => [
  ...(deltas?.changed ?? []),
  ...(deltas?.removed ?? [])
];

export const calculateOrderbookStreamChecksum = (input: {
  canonicalMarketId: string;
  canonicalOutcomeId?: string | null | undefined;
  venue?: string | null | undefined;
  bestBid?: string | null | undefined;
  bestAsk?: string | null | undefined;
  bids?: readonly { venue?: string | undefined; price: string; size: string }[] | undefined;
  asks?: readonly { venue?: string | undefined; price: string; size: string }[] | undefined;
  blockers?: readonly string[] | undefined;
}): string => {
  const normalizeLevels = (levels: readonly { venue?: string | undefined; price: string; size: string }[] | undefined) =>
    (levels ?? []).map((level) => ({
      venue: level.venue ? normalizeVenue(level.venue) : undefined,
      price: level.price,
      size: level.size
    }));
  return createHash("sha256")
    .update(JSON.stringify({
      market: input.canonicalMarketId,
      outcome: input.canonicalOutcomeId ?? null,
      venue: input.venue ? normalizeVenue(input.venue) : null,
      bestBid: input.bestBid ?? null,
      bestAsk: input.bestAsk ?? null,
      bids: normalizeLevels(input.bids),
      asks: normalizeLevels(input.asks),
      blockers: [...(input.blockers ?? [])].sort()
    }))
    .digest("hex")
    .slice(0, 16);
};

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
  restRefreshed: 0,
  restRefreshedByVenue: {}
});

const emptyRestRefreshResult = (): { total: number; byVenue: Readonly<Record<string, number>> } => ({
  total: 0,
  byVenue: {}
});
