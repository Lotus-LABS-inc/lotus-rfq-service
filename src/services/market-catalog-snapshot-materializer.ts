import type { MarketCatalogMarket, MarketCatalogRepository } from "../repositories/market-catalog.repository.js";
import {
  DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
  type MarketQuoteReadinessSnapshot
} from "../repositories/venue-orderbook-snapshot.repository.js";
import type { MarketCatalogSnapshotCache } from "./market-catalog-snapshot-cache.js";

type RouteCoverage = "all" | "single" | "pair" | "tri" | "strict_all";
export type MarketCatalogListView = "full" | "compact";

export interface MarketCatalogSnapshotMaterializerConfig {
  intervalMs: number;
  cacheTtlMs: number;
  limits: readonly number[];
  routeCoverages: readonly RouteCoverage[];
  categories: readonly string[];
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
  intervalMs: 120_000,
  cacheTtlMs: 1_800_000,
  limits: [80, 250],
  routeCoverages: ["all", "pair", "tri", "strict_all"],
  categories: ["Crypto", "Sports", "Politics", "Esports"]
};

const OVERFETCH_MULTIPLIER = 4;
const OVERFETCH_MIN = 250;
const OVERFETCH_CAP = 1_000;

export class MarketCatalogSnapshotMaterializer {
  private readonly config: MarketCatalogSnapshotMaterializerConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  public constructor(private readonly deps: MarketCatalogSnapshotMaterializerDeps) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...(deps.config ?? {}),
      limits: sanitizeLimits(deps.config?.limits ?? DEFAULT_CONFIG.limits),
      routeCoverages: sanitizeRouteCoverages(deps.config?.routeCoverages ?? DEFAULT_CONFIG.routeCoverages),
      categories: sanitizeCategories(deps.config?.categories ?? DEFAULT_CONFIG.categories)
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
      for (const limit of this.config.limits) {
        for (const category of [...this.config.categories, undefined] as const) {
          const baseQueries = [
            withOptionalCategory({ limit }, category),
            withOptionalCategory({ limit, quoteReadyOnly: false as const }, category),
            withOptionalCategory({ limit, quoteReadyOnly: false as const, routeCoverage: "all" as const }, category),
            withOptionalCategory({ limit, quoteReadyOnly: true as const }, category),
            withOptionalCategory({ limit, quoteReadyOnly: true as const, routeCoverage: "all" as const }, category),
            ...this.config.routeCoverages
              .filter((routeCoverage) => routeCoverage !== "all")
              .map((routeCoverage) => withOptionalCategory({ limit, quoteReadyOnly: true as const, routeCoverage }, category))
          ];
          for (const query of baseQueries) {
            if (this.stopped) {
              return result;
            }
            result.attempted += 1;
            try {
              const written = await this.materializeMarketQuery(query, detailKeysWritten);
              if (typeof written === "number") result.written += written;
              if (written === "skipped_empty_quote_ready") result.skippedEmptyQuoteReady += 1;
              if (written === "skipped_underfilled_quote_ready") result.skippedUnderfilledQuoteReady += 1;
            } catch (error) {
              result.failed += 1;
              this.deps.logger.warn({ err: error, query }, "Market catalog snapshot query materialization failed.");
            }
          }
        }
      }
      this.deps.logger.info(result as unknown as Record<string, unknown>, "Market catalog snapshots materialized.");
      return result;
    } finally {
      this.running = false;
    }
  }

  private async materializeMarketQuery(
    query: MarketCatalogMaterializedQuery,
    detailKeysWritten: Set<string>
  ): Promise<number | "skipped_empty_quote_ready" | "skipped_underfilled_quote_ready"> {
    const markets = await this.deps.marketCatalogRepository.listMarkets({
      limit: resolveFetchLimit(query.limit, query),
      ...(query.category ? { category: query.category } : {})
    });
    const readiness = await this.deps.marketQuoteReadinessSource.listLatestMarketQuoteReadiness({
      canonicalMarketIds: [...new Set(markets.flatMap((market) => market.canonicalMarketIds))]
    });
    const enriched = enrichMarketsWithReadiness(markets, readiness);
    const routeCoverage = query.routeCoverage ?? "all";
    const baseVisibleMarkets = enriched
      .filter((market) => !query.quoteReadyOnly || isQuoteReadyMarket(market))
      .filter((market) => routeCoverageMatches(market, routeCoverage))
      .slice(0, query.limit);
    const fullKey = `markets:${stableQueryCacheKey(query)}`;
    let visibleMarkets = await this.mergeGlobalQuoteReadyCategorySnapshots(query, baseVisibleMarkets, routeCoverage);

    if (query.quoteReadyOnly) {
      const recoveredMarkets = await this.recoverQuoteReadyMarketsFromExistingSnapshots(query, fullKey, routeCoverage);
      visibleMarkets = mergeMarketCatalogMarkets(visibleMarkets, recoveredMarkets, query.limit);
    }

    if (query.quoteReadyOnly && visibleMarkets.length === 0) {
      return "skipped_empty_quote_ready";
    }

    if (query.quoteReadyOnly && await this.wouldUnderfillExistingSnapshot(query, fullKey, visibleMarkets.length)) {
      return "skipped_underfilled_quote_ready";
    }

    await this.writeMarketSnapshots(query, visibleMarkets);
    await this.materializeMarketDetailSnapshots(visibleMarkets, detailKeysWritten);
    return 2;
  }

  private async writeMarketSnapshots(
    query: MarketCatalogMaterializedQuery,
    visibleMarkets: readonly MarketCatalogMarket[]
  ): Promise<void> {
    const fullKey = `markets:${stableQueryCacheKey(query)}`;
    await this.deps.snapshotCache.set(fullKey, {
      markets: formatMarketCatalogListMarkets(visibleMarkets, undefined),
      count: visibleMarkets.length,
      materialized: true,
      materializedAt: new Date().toISOString()
    }, this.config.cacheTtlMs);
    await this.deps.snapshotCache.set(`markets:${stableQueryCacheKey({ ...query, view: "compact" })}`, {
      markets: formatMarketCatalogListMarkets(visibleMarkets, "compact"),
      count: visibleMarkets.length,
      materialized: true,
      materializedAt: new Date().toISOString(),
      view: "compact"
    }, this.config.cacheTtlMs);
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
    fullKey: string,
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
      const exact = await this.deps.snapshotCache.get<{ markets?: unknown }>(fullKey);
      if (Array.isArray(exact?.markets)) {
        addMarkets(exact.markets.filter(isMarketCatalogMarket));
      }
    } catch {
      // Ignore display-cache recovery misses.
    }
    if (query.category) {
      try {
        const globalKey = `markets:${stableQueryCacheKey({ ...query, category: undefined })}`;
        const global = await this.deps.snapshotCache.get<{ markets?: unknown }>(globalKey);
        if (Array.isArray(global?.markets)) {
          addMarkets(global.markets.filter(isMarketCatalogMarket));
        }
      } catch {
        // Ignore display-cache recovery misses.
      }
    }
    return [...recovered.values()].slice(0, query.limit);
  }

  private async wouldUnderfillExistingSnapshot(
    query: MarketCatalogMaterializedQuery,
    fullKey: string,
    nextCount: number
  ): Promise<boolean> {
    try {
      const existing = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(fullKey);
      const existingCount = typeof existing?.count === "number"
        ? existing.count
        : Array.isArray(existing?.markets)
          ? existing.markets.length
          : 0;
      if (existingCount <= nextCount) {
        return false;
      }
      if (existing && Array.isArray(existing.markets)) {
        await this.ensureCompactSnapshotFromExisting(query, existing);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async ensureCompactSnapshotFromExisting(
    query: MarketCatalogMaterializedQuery,
    existing: { count?: unknown; markets?: unknown }
  ): Promise<void> {
    const compactKey = `markets:${stableQueryCacheKey({ ...query, view: "compact" })}`;
    const currentCompact = await this.deps.snapshotCache.get<{ count?: unknown; markets?: unknown }>(compactKey);
    const currentCompactCount = typeof currentCompact?.count === "number"
      ? currentCompact.count
      : Array.isArray(currentCompact?.markets)
        ? currentCompact.markets.length
        : 0;
    const existingMarkets = Array.isArray(existing.markets)
      ? existing.markets
      : [];
    if (currentCompactCount >= existingMarkets.length || existingMarkets.length === 0) {
      return;
    }
    await this.deps.snapshotCache.set(compactKey, {
      markets: formatMarketCatalogListMarkets(existingMarkets as MarketCatalogMarket[], "compact"),
      count: existingMarkets.length,
      materialized: true,
      materializedAt: new Date().toISOString(),
      view: "compact"
    }, this.config.cacheTtlMs);
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
  return Date.now() - timestampMs <= DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS;
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
