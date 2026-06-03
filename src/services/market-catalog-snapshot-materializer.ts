import type { MarketCatalogMarket, MarketCatalogRepository } from "../repositories/market-catalog.repository.js";
import {
  DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS,
  DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
  type MarketQuoteReadinessSnapshot
} from "../repositories/venue-orderbook-snapshot.repository.js";
import type { MarketCatalogSnapshotCache } from "./market-catalog-snapshot-cache.js";

type RouteCoverage = "all" | "single" | "pair" | "tri" | "strict_all";
export type MarketCatalogListView = "full" | "compact";

export interface MarketCatalogSnapshotMaterializerConfig {
  intervalMs: number;
  cacheTtlMs: number;
  bestSnapshotTtlMs: number;
  quoteReadinessMaxAgeMs: number;
  limits: readonly number[];
  routeCoverages: readonly RouteCoverage[];
  categories: readonly string[];
  categoryRefreshEveryTicks: number;
}

export interface MarketCatalogSnapshotMaterializerLogger {
  info(input: Record<string, unknown>, message: string): void;
  warn(input: Record<string, unknown>, message: string): void;
}

export interface MarketCatalogSnapshotMaterializerRunResult {
  attempted: number;
  written: number;
  skippedEmptyQuoteReady: number;
  skippedUnderfilledQuoteReady: number;
  failed: number;
}

export interface MarketCatalogSnapshotMaterializerDeps {
  marketCatalogRepository: Pick<MarketCatalogRepository, "listMarkets">;
  marketQuoteReadinessSource: {
    listLatestMarketQuoteReadiness(input: {
      canonicalMarketIds: readonly string[];
      maxAgeMs?: number | undefined;
    }): Promise<MarketQuoteReadinessSnapshot[]>;
  };
  snapshotCache: MarketCatalogSnapshotCache;
  logger: MarketCatalogSnapshotMaterializerLogger;
  config?: Partial<MarketCatalogSnapshotMaterializerConfig> | undefined;
}

const DEFAULT_CONFIG: MarketCatalogSnapshotMaterializerConfig = {
  intervalMs: 5_000,
  cacheTtlMs: 60_000,
  bestSnapshotTtlMs: 15 * 60_000,
  quoteReadinessMaxAgeMs: DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
  limits: [250],
  routeCoverages: ["all", "pair", "tri", "strict_all"],
  categories: ["Crypto", "Sports", "Politics", "Esports"],
  categoryRefreshEveryTicks: 4
};

const OVERFETCH_MULTIPLIER = 4;
const OVERFETCH_MIN = 250;
const OVERFETCH_CAP = 1_000;

export class MarketCatalogSnapshotMaterializer {
  private readonly config: MarketCatalogSnapshotMaterializerConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private tickIndex = 0;

  public constructor(private readonly deps: MarketCatalogSnapshotMaterializerDeps) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...(deps.config ?? {}),
      limits: sanitizeLimits(deps.config?.limits ?? DEFAULT_CONFIG.limits),
      routeCoverages: sanitizeRouteCoverages(deps.config?.routeCoverages ?? DEFAULT_CONFIG.routeCoverages),
      categories: sanitizeCategories(deps.config?.categories ?? DEFAULT_CONFIG.categories),
      categoryRefreshEveryTicks: sanitizePositiveInteger(
        deps.config?.categoryRefreshEveryTicks ?? DEFAULT_CONFIG.categoryRefreshEveryTicks,
        DEFAULT_CONFIG.categoryRefreshEveryTicks
      )
    };
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.stopped = false;
    void this.runOnce().catch((error) => {
      this.deps.logger.warn({ err: error }, "Initial market catalog snapshot materialization failed.");
    });
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.deps.logger.warn({ err: error }, "Market catalog snapshot materialization tick failed.");
      });
    }, Math.max(1_000, this.config.intervalMs));
    this.timer.unref?.();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (!this.timer) {
      await this.waitForIdle();
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    await this.waitForIdle();
  }

  public async runOnce(): Promise<MarketCatalogSnapshotMaterializerRunResult> {
    if (this.stopped || this.running) {
      return { attempted: 0, written: 0, skippedEmptyQuoteReady: 0, skippedUnderfilledQuoteReady: 0, failed: 0 };
    }
    this.running = true;
    const result: MarketCatalogSnapshotMaterializerRunResult = {
      attempted: 0,
      written: 0,
      skippedEmptyQuoteReady: 0,
      skippedUnderfilledQuoteReady: 0,
      failed: 0
    };
    try {
      const detailKeysWritten = new Set<string>();
      const tickIndex = this.tickIndex;
      this.tickIndex += 1;
      const categories = tickIndex % this.config.categoryRefreshEveryTicks === 0
        ? [undefined, ...this.config.categories] as const
        : [undefined] as const;
      for (const limit of this.config.limits) {
        for (const category of categories) {
          if (this.stopped) {
            return result;
          }
          const queries = buildMaterializedQueries(limit, category, this.config.routeCoverages);
          result.attempted += queries.length;
          try {
            const written = await this.materializeMarketQuerySet(limit, category, queries, detailKeysWritten);
            result.written += written.written;
            result.skippedEmptyQuoteReady += written.skippedEmptyQuoteReady;
            result.skippedUnderfilledQuoteReady += written.skippedUnderfilledQuoteReady;
            result.failed += written.failed;
          } catch (error) {
            result.failed += queries.length;
            this.deps.logger.warn({ err: error, limit, category }, "Market catalog snapshot query-set materialization failed.");
          }
        }
      }
      this.deps.logger.info(result as unknown as Record<string, unknown>, "Market catalog snapshots materialized.");
      return result;
    } finally {
      this.running = false;
    }
  }

  private async materializeMarketQuerySet(
    limit: number,
    category: string | undefined,
    queries: readonly MarketCatalogMaterializedQuery[],
    detailKeysWritten: Set<string>
  ): Promise<{
    written: number;
    skippedEmptyQuoteReady: number;
    skippedUnderfilledQuoteReady: number;
    failed: number;
  }> {
    const markets = await this.deps.marketCatalogRepository.listMarkets({
      limit: resolveFetchLimit(limit, { limit, quoteReadyOnly: true, routeCoverage: "all" }),
      ...(category ? { category } : {})
    });
    const readiness = await this.deps.marketQuoteReadinessSource.listLatestMarketQuoteReadiness({
      canonicalMarketIds: [...new Set(markets.flatMap((market) => market.canonicalMarketIds))],
      maxAgeMs: this.config.quoteReadinessMaxAgeMs
    });
    const enriched = enrichMarketsWithReadiness(markets, readiness);
    const result = {
      written: 0,
      skippedEmptyQuoteReady: 0,
      skippedUnderfilledQuoteReady: 0,
      failed: 0
    };
    for (const query of queries) {
      try {
        const written = await this.materializeMarketQueryFromEnriched(query, enriched, detailKeysWritten);
        if (typeof written === "number") result.written += written;
        if (written === "skipped_empty_quote_ready") result.skippedEmptyQuoteReady += 1;
        if (written === "skipped_underfilled_quote_ready") result.skippedUnderfilledQuoteReady += 1;
      } catch (error) {
        result.failed += 1;
        this.deps.logger.warn({ err: error, query }, "Market catalog snapshot query materialization failed.");
      }
    }
    return result;
  }

  private async materializeMarketQueryFromEnriched(
    query: MarketCatalogMaterializedQuery,
    enriched: readonly MarketCatalogMarket[],
    detailKeysWritten: Set<string>
  ): Promise<number | "skipped_empty_quote_ready" | "skipped_underfilled_quote_ready"> {
    const routeCoverage = query.routeCoverage ?? "all";
    const baseVisibleMarkets = enriched
      .filter((market) => !query.quoteReadyOnly || isQuoteReadyMarket(market))
      .filter((market) => routeCoverageMatches(market, routeCoverage))
      .slice(0, query.limit);
    let visibleMarkets = await this.mergeGlobalQuoteReadyCategorySnapshots(query, baseVisibleMarkets, routeCoverage);

    if (query.quoteReadyOnly) {
      const recoveredMarkets = await this.recoverQuoteReadyMarketsFromExistingSnapshots(query, routeCoverage);
      visibleMarkets = mergeMarketCatalogMarkets(visibleMarkets, recoveredMarkets, query.limit);
    }

    if (query.quoteReadyOnly && visibleMarkets.length === 0) {
      return "skipped_empty_quote_ready";
    }

    if (query.quoteReadyOnly && await this.wouldUnderfillExistingSnapshot(query, marketCatalogSnapshotKeys(query), visibleMarkets)) {
      return "skipped_underfilled_quote_ready";
    }

    await this.writeMarketSnapshots(query, visibleMarkets);
    if (query.quoteReadyOnly) {
      await this.writeBestMarketSnapshots(query, visibleMarkets);
    }
    await this.materializeMarketDetailSnapshots(visibleMarkets, detailKeysWritten);
    return 2;
  }

  private async writeMarketSnapshots(
    query: MarketCatalogMaterializedQuery,
    visibleMarkets: readonly MarketCatalogMarket[]
  ): Promise<void> {
    const materializedAt = new Date().toISOString();
    for (const fullKey of marketCatalogSnapshotKeys(query)) {
      await this.deps.snapshotCache.set(fullKey, {
        markets: formatMarketCatalogListMarkets(visibleMarkets, undefined),
        count: visibleMarkets.length,
        materialized: true,
        materializedAt
      }, this.config.cacheTtlMs);
    }
    for (const compactKey of marketCatalogSnapshotKeys({ ...query, view: "compact" })) {
      await this.deps.snapshotCache.set(compactKey, {
        markets: formatMarketCatalogListMarkets(visibleMarkets, "compact"),
        count: visibleMarkets.length,
        materialized: true,
        materializedAt,
        view: "compact"
      }, this.config.cacheTtlMs);
    }
  }

  private async writeBestMarketSnapshots(
    query: MarketCatalogMaterializedQuery,
    visibleMarkets: readonly MarketCatalogMarket[]
  ): Promise<void> {
    if (visibleMarkets.length === 0) {
      return;
    }
    const materializedAt = new Date().toISOString();
    for (const key of bestMarketCatalogSnapshotKeys(query)) {
      const existing = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(key);
      if (!shouldReplaceSnapshotWithMarkets(existing, visibleMarkets)) {
        continue;
      }
      await this.deps.snapshotCache.set(key, {
        markets: formatMarketCatalogListMarkets(visibleMarkets, undefined),
        count: visibleMarkets.length,
        materialized: true,
        materializedAt,
        bestSnapshot: true
      }, this.config.bestSnapshotTtlMs);
    }
    for (const key of bestMarketCatalogSnapshotKeys({ ...query, view: "compact" })) {
      const existing = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(key);
      if (!shouldReplaceSnapshotWithMarkets(existing, visibleMarkets)) {
        continue;
      }
      await this.deps.snapshotCache.set(key, {
        markets: formatMarketCatalogListMarkets(visibleMarkets, "compact"),
        count: visibleMarkets.length,
        materialized: true,
        materializedAt,
        bestSnapshot: true,
        view: "compact"
      }, this.config.bestSnapshotTtlMs);
    }
  }

  private async materializeMarketDetailSnapshots(
    markets: readonly MarketCatalogMarket[],
    detailKeysWritten: Set<string>
  ): Promise<void> {
    for (const market of markets) {
      const payload = {
        market,
        materialized: true,
        materializedAt: new Date().toISOString()
      };
      for (const key of marketCatalogDetailAliasKeys(market)) {
        if (detailKeysWritten.has(key)) {
          continue;
        }
        detailKeysWritten.add(key);
        await this.deps.snapshotCache.set(key, payload, this.config.cacheTtlMs);
      }
    }
  }

  private async mergeGlobalQuoteReadyCategorySnapshots(
    query: MarketCatalogMaterializedQuery,
    visibleMarkets: readonly MarketCatalogMarket[],
    routeCoverage: RouteCoverage
  ): Promise<MarketCatalogMarket[]> {
    if (query.category || !query.quoteReadyOnly || this.config.categories.length === 0) {
      return [...visibleMarkets];
    }
    const byKey = new Map(visibleMarkets.map((market) => [marketIdentityKey(market), market] as const));
    for (const category of this.config.categories) {
      const categoryKey = `markets:${stableQueryCacheKey({ ...query, category })}`;
      try {
        const cached = await this.deps.snapshotCache.get<{ markets?: unknown }>(categoryKey);
        const markets = Array.isArray(cached?.markets)
          ? cached.markets.filter(isMarketCatalogMarket)
          : [];
        for (const market of markets) {
          if (!isQuoteReadyMarket(market) || !routeCoverageMatches(market, routeCoverage)) {
            continue;
          }
          byKey.set(marketIdentityKey(market), market);
        }
      } catch {
        // Category snapshots are display fallbacks only. A cache miss should not block materialization.
      }
    }
    return [...byKey.values()].slice(0, query.limit);
  }

  private async recoverQuoteReadyMarketsFromExistingSnapshots(
    query: MarketCatalogMaterializedQuery,
    routeCoverage: RouteCoverage
  ): Promise<MarketCatalogMarket[]> {
    const recovered = new Map<string, MarketCatalogMarket>();
    const addMarkets = (markets: readonly MarketCatalogMarket[]): void => {
      for (const market of markets) {
        if (query.category && market.category.toLowerCase() !== query.category.toLowerCase()) {
          continue;
        }
        if (!isQuoteReadyMarket(market) || !routeCoverageMatches(market, routeCoverage)) {
          continue;
        }
        recovered.set(marketIdentityKey(market), market);
      }
    };
    try {
      for (const key of marketCatalogSnapshotKeys(query)) {
        const exact = await this.deps.snapshotCache.get<{ markets?: unknown }>(key);
        if (Array.isArray(exact?.markets)) {
          addMarkets(exact.markets.filter(isMarketCatalogMarket));
        }
      }
      for (const key of bestMarketCatalogSnapshotKeys(query)) {
        const best = await this.deps.snapshotCache.get<{ markets?: unknown }>(key);
        if (Array.isArray(best?.markets)) {
          addMarkets(best.markets.filter(isMarketCatalogMarket));
        }
      }
    } catch {
      // Ignore display-cache recovery misses.
    }
    if (query.category) {
      try {
        for (const globalKey of marketCatalogSnapshotKeys({ ...query, category: undefined })) {
          const global = await this.deps.snapshotCache.get<{ markets?: unknown }>(globalKey);
          if (Array.isArray(global?.markets)) {
            addMarkets(global.markets.filter(isMarketCatalogMarket));
          }
        }
        for (const globalBestKey of bestMarketCatalogSnapshotKeys({ ...query, category: undefined })) {
          const globalBest = await this.deps.snapshotCache.get<{ markets?: unknown }>(globalBestKey);
          if (Array.isArray(globalBest?.markets)) {
            addMarkets(globalBest.markets.filter(isMarketCatalogMarket));
          }
        }
      } catch {
        // Ignore display-cache recovery misses.
      }
    }
    return [...recovered.values()].slice(0, query.limit);
  }

  private async wouldUnderfillExistingSnapshot(
    query: MarketCatalogMaterializedQuery,
    keys: readonly string[],
    nextMarkets: readonly MarketCatalogMarket[]
  ): Promise<boolean> {
    try {
      let bestExisting: { count?: unknown; markets?: unknown } | null = null;
      let existingMarkets: MarketCatalogMarket[] = [];
      for (const key of keys) {
        const existing = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(key);
        const markets = Array.isArray(existing?.markets)
          ? existing.markets.filter(isMarketCatalogMarket).filter(isQuoteReadyMarket)
          : [];
        if (compareMarketSnapshotQuality(markets, existingMarkets) > 0) {
          bestExisting = existing;
          existingMarkets = markets;
        }
      }
      for (const key of bestMarketCatalogSnapshotKeys(query)) {
        const existing = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(key);
        const markets = Array.isArray(existing?.markets)
          ? existing.markets.filter(isMarketCatalogMarket).filter(isQuoteReadyMarket)
          : [];
        if (compareMarketSnapshotQuality(markets, existingMarkets) > 0) {
          bestExisting = existing;
          existingMarkets = markets;
        }
      }
      if (compareMarketSnapshotQuality(existingMarkets, nextMarkets) <= 0) {
        return false;
      }
      if (bestExisting && existingMarkets.length > 0) {
        await this.ensureSnapshotsFromExisting(query, {
          ...bestExisting,
          count: existingMarkets.length,
          markets: existingMarkets
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  private async ensureSnapshotsFromExisting(
    query: MarketCatalogMaterializedQuery,
    existing: { count?: unknown; markets?: unknown }
  ): Promise<void> {
    const existingMarkets = Array.isArray(existing.markets)
      ? existing.markets
      : [];
    if (existingMarkets.length === 0) {
      return;
    }
    const materializedAt = new Date().toISOString();
    for (const fullKey of marketCatalogSnapshotKeys(query)) {
      const current = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(fullKey);
      if (shouldReplaceSnapshotWithMarkets(current, existingMarkets as MarketCatalogMarket[])) {
        await this.deps.snapshotCache.set(fullKey, {
          markets: existingMarkets,
          count: existingMarkets.length,
          materialized: true,
          materializedAt
        }, this.config.cacheTtlMs);
      }
    }
    for (const compactKey of marketCatalogSnapshotKeys({ ...query, view: "compact" })) {
      const currentCompact = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(compactKey);
      if (!shouldReplaceSnapshotWithMarkets(currentCompact, existingMarkets as MarketCatalogMarket[])) {
        continue;
      }
      await this.deps.snapshotCache.set(compactKey, {
        markets: formatMarketCatalogListMarkets(existingMarkets as MarketCatalogMarket[], "compact"),
        count: existingMarkets.length,
        materialized: true,
        materializedAt,
        view: "compact"
      }, this.config.cacheTtlMs);
    }
  }

  private async waitForIdle(): Promise<void> {
    for (let attempt = 0; attempt < 100 && this.running; attempt += 1) {
      await sleep(50);
    }
  }
}

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

interface MarketCatalogMaterializedQuery {
  limit: number;
  category?: string | undefined;
  quoteReadyOnly?: boolean | undefined;
  routeCoverage?: RouteCoverage | undefined;
  view?: MarketCatalogListView | undefined;
}

const withOptionalCategory = <T extends { limit: number }>(
  query: T,
  category: string | undefined
): T & { category?: string | undefined } =>
  category ? { ...query, category } : query;

const buildMaterializedQueries = (
  limit: number,
  category: string | undefined,
  routeCoverages: readonly RouteCoverage[]
): MarketCatalogMaterializedQuery[] => [
  withOptionalCategory({ limit }, category),
  withOptionalCategory({ limit, quoteReadyOnly: false as const }, category),
  withOptionalCategory({ limit, quoteReadyOnly: false as const, routeCoverage: "all" as const }, category),
  withOptionalCategory({ limit, quoteReadyOnly: true as const }, category),
  withOptionalCategory({ limit, quoteReadyOnly: true as const, routeCoverage: "all" as const }, category),
  ...routeCoverages
    .filter((routeCoverage) => routeCoverage !== "all")
    .map((routeCoverage) => withOptionalCategory({ limit, quoteReadyOnly: true as const, routeCoverage }, category))
];

const marketCatalogSnapshotKeys = (query: MarketCatalogMaterializedQuery): string[] => [
  ...new Set([query, ...marketCatalogAllRouteAliases(query)]
    .map((candidate) => `markets:${stableQueryCacheKey(candidate)}`))
];

const bestMarketCatalogSnapshotKeys = (query: MarketCatalogMaterializedQuery): string[] => [
  ...new Set(marketCatalogSnapshotKeys(query).map((key) => `best:${key}`))
];

const marketCatalogAllRouteAliases = (
  query: MarketCatalogMaterializedQuery
): MarketCatalogMaterializedQuery[] => {
  if (
    query.quoteReadyOnly === true
    && (query.routeCoverage === undefined || query.routeCoverage === "all" || query.routeCoverage === "single")
  ) {
    const { routeCoverage: _routeCoverage, ...rest } = query;
    return [
      rest,
      { ...rest, routeCoverage: "all" },
      { ...rest, routeCoverage: "single" }
    ];
  }
  if (query.routeCoverage === undefined) {
    return [{ ...query, routeCoverage: "all" }];
  }
  if (query.routeCoverage !== "all") {
    return [];
  }
  const { routeCoverage: _routeCoverage, ...rest } = query;
  return [rest];
};

const snapshotMarketCount = (snapshot: { count?: unknown; markets?: unknown } | null): number => {
  if (Array.isArray(snapshot?.markets)) {
    return snapshot.markets.length;
  }
  return typeof snapshot?.count === "number" ? snapshot.count : 0;
};

interface MarketSnapshotQuality {
  distinctVenueCount: number;
  multiVenueMarketCount: number;
  totalReadyVenueMemberships: number;
  marketCount: number;
}

const shouldReplaceSnapshotWithMarkets = (
  existing: { count?: unknown; markets?: unknown } | null,
  nextMarkets: readonly MarketCatalogMarket[]
): boolean => {
  if (!existing) {
    return nextMarkets.length > 0;
  }
  return compareMarketSnapshotQuality(nextMarkets, snapshotMarkets(existing)) > 0;
};

const compareMarketSnapshotQuality = (
  leftMarkets: readonly unknown[],
  rightMarkets: readonly unknown[]
): number => {
  const left = marketSnapshotQuality(leftMarkets);
  const right = marketSnapshotQuality(rightMarkets);
  if (left.distinctVenueCount !== right.distinctVenueCount) {
    return left.distinctVenueCount - right.distinctVenueCount;
  }
  if (left.multiVenueMarketCount !== right.multiVenueMarketCount) {
    return left.multiVenueMarketCount - right.multiVenueMarketCount;
  }
  if (left.totalReadyVenueMemberships !== right.totalReadyVenueMemberships) {
    return left.totalReadyVenueMemberships - right.totalReadyVenueMemberships;
  }
  return left.marketCount - right.marketCount;
};

const marketSnapshotQuality = (markets: readonly unknown[]): MarketSnapshotQuality => {
  const distinctVenues = new Set<string>();
  let multiVenueMarketCount = 0;
  let totalReadyVenueMemberships = 0;
  for (const market of markets) {
    const quoteReadyVenues = quoteReadyVenuesFromMarket(market);
    for (const venue of quoteReadyVenues) {
      distinctVenues.add(venue);
    }
    if (quoteReadyVenues.length > 1) {
      multiVenueMarketCount += 1;
    }
    totalReadyVenueMemberships += quoteReadyVenues.length;
  }
  return {
    distinctVenueCount: distinctVenues.size,
    multiVenueMarketCount,
    totalReadyVenueMemberships,
    marketCount: markets.length
  };
};

const snapshotMarkets = (snapshot: { count?: unknown; markets?: unknown }): readonly unknown[] => {
  if (Array.isArray(snapshot.markets)) {
    return snapshot.markets;
  }
  const count = snapshotMarketCount(snapshot);
  return count > 0 ? Array.from({ length: count }) : [];
};

const quoteReadyVenuesFromMarket = (market: unknown): string[] => {
  if (!market || typeof market !== "object") {
    return [];
  }
  const quoteReadyVenues = (market as { quoteReadyVenues?: unknown }).quoteReadyVenues;
  if (!Array.isArray(quoteReadyVenues)) {
    return [];
  }
  return [...new Set(quoteReadyVenues
    .filter((venue): venue is string => typeof venue === "string")
    .map((venue) => venue.trim().toUpperCase())
    .filter(Boolean))];
};

export interface CompactMarketCatalogMarket {
  eventId?: string | undefined;
  eventTitle?: string | undefined;
  canonicalEventId: string;
  canonicalMarketIds: string[];
  displayTopic: string;
  displayOutcome: string;
  displayOutcomeKey: string;
  title: string;
  normalizedTitle: string;
  category: string;
  marketClass: string;
  status: MarketCatalogMarket["status"];
  startsAt: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
  venues: string[];
  venueCount: number;
  venueMarketCount: number;
  outcomeCount: number;
  routeability: MarketCatalogMarket["routeability"];
  imageUrl: string | null;
  iconUrl: string | null;
  volume: string | null;
  volume24h: string | null;
  liquidity: string | null;
  buyVolume: string | null;
  sellVolume: string | null;
  tradeCount: string | null;
  buyCount: string | null;
  sellCount: string | null;
  quoteStatus?: MarketCatalogMarket["quoteStatus"] | undefined;
  quoteReadyVenueCount?: number | undefined;
  quoteReadyVenues?: string[] | undefined;
  quoteBlockers?: MarketCatalogMarket["quoteBlockers"] | undefined;
  lastQuoteAt?: string | null | undefined;
  updatedAt: string;
}

export const marketCatalogDetailCacheKey = (marketId: string): string =>
  `market-detail:${marketId}`;

export const marketCatalogDetailAliasKeys = (market: MarketCatalogMarket): string[] => {
  const aliases = new Set<string>();
  const addAlias = (value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) {
      aliases.add(marketCatalogDetailCacheKey(trimmed));
    }
  };
  addAlias(market.canonicalEventId);
  addAlias(market.eventId);
  for (const canonicalMarketId of market.canonicalMarketIds) {
    addAlias(canonicalMarketId);
    for (const venue of market.venues) {
      addAlias(`${canonicalMarketId}:${venue}`);
    }
    if (!canonicalMarketId.toUpperCase().startsWith("FRONTEND_CURATED:")) {
      for (const venue of market.venues) {
        addAlias(`FRONTEND_CURATED:${canonicalMarketId}:${venue}`);
      }
    }
  }
  for (const venueMarket of market.venueMarkets) {
    addAlias(venueMarket.venueMarketId);
    addAlias(venueMarket.venueMarketProfileId);
  }
  return [...aliases];
};

export const formatMarketCatalogListMarkets = (
  markets: readonly MarketCatalogMarket[],
  view: MarketCatalogListView | undefined
): MarketCatalogMarket[] | CompactMarketCatalogMarket[] =>
  view === "compact" ? markets.map(toCompactMarketCatalogMarket) : [...markets];

const toCompactMarketCatalogMarket = (market: MarketCatalogMarket): CompactMarketCatalogMarket => ({
  ...(market.eventId ? { eventId: market.eventId } : {}),
  ...(market.eventTitle ? { eventTitle: market.eventTitle } : {}),
  canonicalEventId: market.canonicalEventId,
  canonicalMarketIds: market.canonicalMarketIds,
  displayTopic: market.displayTopic,
  displayOutcome: market.displayOutcome,
  displayOutcomeKey: market.displayOutcomeKey,
  title: market.title,
  normalizedTitle: market.normalizedTitle,
  category: market.category,
  marketClass: market.marketClass,
  status: market.status,
  startsAt: market.startsAt,
  expiresAt: market.expiresAt,
  resolvesAt: market.resolvesAt,
  venues: market.venues,
  venueCount: market.venueCount,
  venueMarketCount: market.venueMarketCount,
  outcomeCount: market.outcomeCount,
  routeability: market.routeability,
  imageUrl: market.imageUrl,
  iconUrl: market.iconUrl,
  volume: market.volume,
  volume24h: market.volume24h,
  liquidity: market.liquidity,
  buyVolume: market.buyVolume,
  sellVolume: market.sellVolume,
  tradeCount: market.tradeCount,
  buyCount: market.buyCount,
  sellCount: market.sellCount,
  ...(market.quoteStatus ? { quoteStatus: market.quoteStatus } : {}),
  ...(market.quoteReadyVenueCount !== undefined ? { quoteReadyVenueCount: market.quoteReadyVenueCount } : {}),
  ...(market.quoteReadyVenues ? { quoteReadyVenues: market.quoteReadyVenues } : {}),
  ...(market.quoteBlockers ? { quoteBlockers: market.quoteBlockers } : {}),
  ...(market.lastQuoteAt !== undefined ? { lastQuoteAt: market.lastQuoteAt } : {}),
  updatedAt: market.updatedAt
});

export const stableQueryCacheKey = (query: object): string =>
  JSON.stringify(Object.keys(query)
    .sort()
    .reduce<Record<string, unknown>>((memo, key) => {
      const value = (query as Record<string, unknown>)[key];
      if (value !== undefined) {
        memo[key] = value;
      }
      return memo;
    }, {}));

const enrichMarketsWithReadiness = (
  markets: readonly MarketCatalogMarket[],
  readiness: readonly MarketQuoteReadinessSnapshot[]
): MarketCatalogMarket[] => {
  const byCanonicalMarketId = new Map(readiness.map((item) => [item.canonicalMarketId, item]));
  return markets.map((market) => {
    const marketReadiness = market.canonicalMarketIds
      .map((canonicalMarketId) => byCanonicalMarketId.get(canonicalMarketId))
      .filter((item): item is MarketQuoteReadinessSnapshot => item !== undefined);
    return {
      ...market,
      ...aggregateMarketQuoteReadiness(marketReadiness)
    };
  });
};

const aggregateMarketQuoteReadiness = (
  readiness: readonly MarketQuoteReadinessSnapshot[]
): Pick<MarketCatalogMarket, "quoteStatus" | "quoteReadyVenueCount" | "quoteReadyVenues" | "quoteBlockers" | "lastQuoteAt"> => {
  if (readiness.length === 0) {
    return {
      quoteStatus: "unavailable",
      quoteReadyVenueCount: 0,
      quoteReadyVenues: [],
      quoteBlockers: [],
      lastQuoteAt: null
    };
  }
  const tradableReadiness = readiness.filter(isTradableReadinessSnapshot);
  const quoteReadyVenues = [...new Set(tradableReadiness
    .flatMap((item) => item.quoteReadyVenues.length > 0 ? item.quoteReadyVenues : [])
    .map((venue) => venue.trim().toUpperCase())
    .filter(Boolean))].sort();
  return {
    quoteStatus: pickMarketQuoteStatus(readiness),
    quoteReadyVenueCount: quoteReadyVenues.length > 0
      ? quoteReadyVenues.length
      : tradableReadiness.reduce((sum, item) => sum + item.quoteReadyVenueCount, 0),
    quoteReadyVenues,
    quoteBlockers: [...new Map(readiness
      .flatMap((item) => item.quoteBlockers)
      .map((blocker) => [`${blocker.venue}:${blocker.reason}:${blocker.venueMarketId ?? ""}:${blocker.venueOutcomeId ?? ""}`, blocker] as const)
    ).values()],
    lastQuoteAt: readiness
      .map((item) => item.lastQuoteAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  };
};

const pickMarketQuoteStatus = (readiness: readonly MarketQuoteReadinessSnapshot[]): MarketCatalogMarket["quoteStatus"] => {
  const tradableStatuses = new Set(readiness
    .filter(isTradableReadinessSnapshot)
    .map((item) => item.quoteStatus));
  if (tradableStatuses.has("live")) return "live";
  if (tradableStatuses.has("partial")) return "partial";
  const statuses = new Set(readiness.map((item) => item.quoteStatus));
  if (statuses.has("live") || statuses.has("partial") || statuses.has("stale")) return "stale";
  return "unavailable";
};

const isTradableReadinessSnapshot = (snapshot: MarketQuoteReadinessSnapshot): boolean =>
  (snapshot.quoteStatus === "live" || snapshot.quoteStatus === "partial")
  && hasRecentQuoteTimestamp(snapshot.lastQuoteAt);

const isQuoteReadyMarket = (market: MarketCatalogMarket): boolean =>
  (market.quoteReadyVenueCount ?? 0) > 0
  && (market.quoteStatus === "live" || market.quoteStatus === "partial")
  && hasRecentQuoteTimestamp(market.lastQuoteAt);

const hasRecentQuoteTimestamp = (value: unknown): boolean => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  return Date.now() - timestampMs <= DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS;
};

const marketIdentityKey = (market: MarketCatalogMarket): string =>
  `${market.canonicalEventId}\u0000${market.canonicalMarketIds.join("\u0001")}`;

const mergeMarketCatalogMarkets = (
  primary: readonly MarketCatalogMarket[],
  recovered: readonly MarketCatalogMarket[],
  limit: number
): MarketCatalogMarket[] => {
  if (recovered.length === 0) {
    return [...primary];
  }
  const byKey = new Map(primary.map((market) => [marketIdentityKey(market), market] as const));
  for (const market of recovered) {
    byKey.set(marketIdentityKey(market), market);
  }
  return [...byKey.values()].slice(0, limit);
};

const isMarketCatalogMarket = (value: unknown): value is MarketCatalogMarket =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { canonicalEventId?: unknown }).canonicalEventId === "string" &&
  Array.isArray((value as { canonicalMarketIds?: unknown }).canonicalMarketIds);

const routeCoverageMatches = (market: MarketCatalogMarket, routeCoverage: RouteCoverage): boolean => {
  const readyVenueCount = market.quoteReadyVenueCount ?? 0;
  switch (routeCoverage) {
    case "single":
      return readyVenueCount >= 1;
    case "pair":
      return readyVenueCount >= 2;
    case "tri":
      return readyVenueCount >= 3;
    case "strict_all":
      return market.venueCount > 0 && readyVenueCount >= market.venueCount;
    case "all":
      return true;
  }
};

const resolveFetchLimit = (limit: number, query: MarketCatalogMaterializedQuery): number =>
  query.quoteReadyOnly || (query.routeCoverage !== undefined && query.routeCoverage !== "all")
    ? Math.min(Math.max(limit * OVERFETCH_MULTIPLIER, OVERFETCH_MIN), OVERFETCH_CAP)
    : limit;

const sanitizeLimits = (limits: readonly number[]): number[] => {
  const values = [...new Set(limits
    .map((value) => Math.floor(value))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((left, right) => left - right);
  return values.length > 0 ? values : [...DEFAULT_CONFIG.limits];
};

const sanitizeRouteCoverages = (routeCoverages: readonly RouteCoverage[]): RouteCoverage[] => {
  const allowed = new Set<RouteCoverage>(["all", "single", "pair", "tri", "strict_all"]);
  const values = [...new Set(routeCoverages.filter((value) => allowed.has(value)))];
  return values.length > 0 ? values : [...DEFAULT_CONFIG.routeCoverages];
};

const sanitizeCategories = (categories: readonly string[]): string[] =>
  [...new Set(categories
    .map((category) => category.trim())
    .filter((category) => category.length > 0))]
    .slice(0, 16);

const sanitizePositiveInteger = (value: number, fallback: number): number => {
  const parsed = Math.floor(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
