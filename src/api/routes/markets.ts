import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../../repositories/market-catalog.repository.js";
import {
  DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS,
  type MarketQuoteReadinessSnapshot
} from "../../repositories/venue-orderbook-snapshot.repository.js";
import type { MarketCatalogSnapshotCache } from "../../services/market-catalog-snapshot-cache.js";
import type { LiveMarketDataViewService, MarketBatchQuoteResponse, MarketChartTimeframe } from "../../services/market-data-view.service.js";
import {
  formatMarketCatalogListMarkets,
  marketCatalogDetailAliasKeys,
  marketCatalogDetailCacheKey
} from "../../services/market-catalog-snapshot-materializer.js";
import { marketOrderbookTopic } from "../../services/orderbook-stream.service.js";

const routeCoverageSchema = z.enum(["all", "single", "pair", "tri", "strict_all"]);
const marketListViewSchema = z.enum(["full", "compact"]);

const listQuerySchema = z.object({
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  routeCoverage: routeCoverageSchema.optional(),
  view: marketListViewSchema.optional(),
  quoteReadyOnly: z.preprocess((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === "true" || value === true) {
      return true;
    }
    if (value === "false" || value === false) {
      return false;
    }
    return value;
  }, z.boolean()).optional()
});

const orderbookQuerySchema = z.object({
  outcomeId: z.string().min(1).optional(),
  venue: z.string().min(1).optional(),
  depth: z.coerce.number().int().positive().max(50).optional()
});

const chartTimeframeSchema = z.enum(["1H", "6H", "1D", "1W", "1M", "ALL"]);

const chartQuerySchema = z.object({
  outcomeId: z.string().min(1).optional(),
  timeframe: chartTimeframeSchema.default("1H")
});

const batchQuotesRequestSchema = z.object({
  items: z.array(z.object({
    marketId: z.string().min(1),
    outcomeId: z.string().min(1),
    side: z.enum(["buy", "sell"]).optional(),
    amount: z.union([z.string().regex(/^\d+(\.\d+)?$/), z.number().positive()]).optional()
  })).min(1).max(60)
});

const VENUE_SUFFIX_PATTERN = /:(POLYMARKET|LIMITLESS|PREDICT|PREDICT_FUN|OPINION|MYRIAD)$/i;
const DEFAULT_MARKET_QUOTE_READINESS_TIMEOUT_MS = 5_000;
const DEFAULT_MARKET_QUOTE_READINESS_STALE_CACHE_MS = DEFAULT_MARKET_QUOTE_READINESS_MAX_AGE_MS;
const DEFAULT_MARKET_LIST_OVERFETCH_MULTIPLIER = 4;
const DEFAULT_MARKET_LIST_OVERFETCH_CAP = 1_000;
const DEFAULT_MARKET_CATALOG_RESPONSE_CACHE_MS = 300_000;
const DEFAULT_MARKET_CATALOG_RESPONSE_STALE_CACHE_MS = 900_000;
const DEFAULT_MARKET_DETAIL_CACHE_MS = 300_000;
const DEFAULT_MARKET_CHART_DETAIL_TIMEOUT_MS = 50;
const DEFAULT_MARKET_CATALOG_ACTIVITY_TOUCH_LIMIT = 60;
const DEFAULT_MARKET_ORDERBOOK_WARMUP_LIMIT = 12;
const MARKET_ORDERBOOK_WARMUP_CACHE_MS = 15_000;
const MARKET_ORDERBOOK_WARMUP_OUTCOMES = ["YES", "NO"] as const;
const MARKET_QUOTE_READINESS_TIMEOUT = Symbol("MARKET_QUOTE_READINESS_TIMEOUT");
const MARKET_DETAIL_TIMEOUT = Symbol("MARKET_DETAIL_TIMEOUT");

interface CachedMarketQuoteReadiness {
  snapshot: MarketQuoteReadinessSnapshot;
  staleUntilMs: number;
}

const marketQuoteReadinessCache = new Map<string, CachedMarketQuoteReadiness>();
const marketCatalogResponseCache = new Map<string, { expiresAtMs: number; staleUntilMs: number; value: unknown }>();
const marketCatalogResponsePending = new Map<string, Promise<unknown>>();
const marketDetailCache = new Map<string, { expiresAtMs: number; value: MarketCatalogMarket | null }>();
const marketDetailPending = new Map<string, Promise<MarketCatalogMarket | null>>();
const marketOrderbookWarmupCache = new Map<string, number>();

export const clearMarketQuoteReadinessCacheForTests = (): void => {
  marketQuoteReadinessCache.clear();
  marketCatalogResponseCache.clear();
  marketCatalogResponsePending.clear();
  marketDetailCache.clear();
  marketDetailPending.clear();
  marketOrderbookWarmupCache.clear();
};

export interface MarketCatalogRouteDeps {
  marketCatalogRepository: Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "listEvents" | "getMarket" | "getEvent">;
  marketQuoteReadinessSource?: {
    listLatestMarketQuoteReadiness(input: {
      canonicalMarketIds: readonly string[];
      maxAgeMs?: number | undefined;
    }): Promise<MarketQuoteReadinessSnapshot[]>;
  } | undefined;
  marketCatalogSnapshotCache?: MarketCatalogSnapshotCache | undefined;
  marketActivityTracker?: {
    touch(input: { canonicalMarketId: string; canonicalOutcomeId?: string | undefined }): void;
  } | undefined;
  marketDataViewService?: Pick<LiveMarketDataViewService, "getOrderbook" | "getChart"> & {
    getBatchQuotes?(input: { items: readonly { marketId: string; outcomeId: string; side?: "buy" | "sell"; amount?: string | number }[] }): Promise<MarketBatchQuoteResponse>;
  } | undefined;
}

export const registerMarketCatalogRoutes = async (
  app: FastifyInstance,
  deps: MarketCatalogRouteDeps
): Promise<void> => {
  app.get("/markets/categories", async (_request, reply) => {
    const categories = await deps.marketCatalogRepository.listCategories();
    return reply.send({
      categories
    });
  });

  app.get("/markets", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MARKET_FILTER",
        message: "Market catalog filter validation failed.",
        details: parsed.error.flatten()
      });
    }
    const payload = await getCachedMarketCatalogResponse(
      `markets:${stableQueryCacheKey(parsed.data)}`,
      async () => {
        const marketLimit = parsed.data.limit === undefined ? undefined : resolveMarketFetchLimit(parsed.data.limit, parsed.data);
        const markets = await deps.marketCatalogRepository.listMarkets({
          ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
          ...(parsed.data.search !== undefined ? { search: parsed.data.search } : {}),
          ...(marketLimit !== undefined ? { limit: marketLimit } : {})
        });
        touchMarketCatalogActivity(markets, deps.marketActivityTracker, DEFAULT_MARKET_CATALOG_ACTIVITY_TOUCH_LIMIT);
        const enriched = await enrichMarketsWithQuoteReadiness(markets, deps.marketQuoteReadinessSource);
        const routeCoverage = parsed.data.routeCoverage ?? "all";
        const visibleMarkets = enriched.markets
          .filter((market) => !parsed.data.quoteReadyOnly || isQuoteReadyMarket(market))
          .filter((market) => routeCoverageMatches(market, routeCoverage))
          .slice(0, parsed.data.limit ?? enriched.markets.length);
        return {
          markets: formatMarketCatalogListMarkets(visibleMarkets, parsed.data.view),
          count: visibleMarkets.length,
          ...(parsed.data.view === "compact" ? { view: "compact" } : {}),
          ...(enriched.degraded ? {
            quoteReadinessDegraded: true,
            quoteReadinessReason: enriched.reason
          } : {})
        };
      },
      {
        cacheDegraded: false,
        sharedCache: deps.marketCatalogSnapshotCache,
        sharedFallbacks: marketCatalogSnapshotFallbacks(parsed.data)
      }
    );
    queueMarketCatalogOrderbookWarmup(payload, deps.marketDataViewService);
    return reply.send(payload);
  });

  const listEventsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MARKET_EVENT_FILTER",
        message: "Market event filter validation failed.",
        details: parsed.error.flatten()
      });
    }
    const payload = await getCachedMarketCatalogResponse(
      `events:${stableQueryCacheKey(parsed.data)}`,
      async () => {
        const events = await deps.marketCatalogRepository.listEvents({
          ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
          ...(parsed.data.search !== undefined ? { search: parsed.data.search } : {}),
          ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {})
        });
        return {
          events,
          count: events.length
        };
      },
      {
        sharedCache: deps.marketCatalogSnapshotCache
      }
    );
    return reply.send(payload);
  };

  app.get("/events", listEventsHandler);
  app.get("/event", listEventsHandler);
  app.get("/market-events", listEventsHandler);

  const getEventHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const event = await deps.marketCatalogRepository.getEvent(eventId);
    if (!event) {
      return reply.status(404).send({
        code: "MARKET_EVENT_NOT_FOUND",
        message: "Market event was not found."
      });
    }
    return reply.send({ event });
  };

  app.get("/events/:eventId", getEventHandler);
  app.get("/event/:eventId", getEventHandler);
  app.get("/market-events/:eventId", getEventHandler);

  const getEventMarketsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const event = await deps.marketCatalogRepository.getEvent(eventId);
    if (!event) {
      return reply.status(404).send({
        code: "MARKET_EVENT_NOT_FOUND",
        message: "Market event was not found."
      });
    }
    return reply.send({
      eventId: event.eventId,
      title: event.title,
      markets: event.markets,
      count: event.markets.length
    });
  };

  app.get("/events/:eventId/markets", getEventMarketsHandler);
  app.get("/event/:eventId/markets", getEventMarketsHandler);
  app.get("/market-events/:eventId/markets", getEventMarketsHandler);

  app.get("/markets/:marketId", async (request, reply) => {
    const { marketId } = request.params as { marketId: string };
    const market = await resolveCachedCatalogMarket(deps.marketCatalogRepository, marketId, deps.marketCatalogSnapshotCache);
    if (!market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    return reply.send({ market });
  });

  app.get("/markets/:marketId/outcomes", async (request, reply) => {
    const { marketId } = request.params as { marketId: string };
    const market = await resolveCachedCatalogMarket(deps.marketCatalogRepository, marketId, deps.marketCatalogSnapshotCache);
    if (!market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    const outcomes = new Map<string, { id: string; label: string; venues: string[] }>();
    for (const venueMarket of market.venueMarkets) {
      for (const outcome of venueMarket.outcomes) {
        const key = outcome.label.toLowerCase();
        const existing = outcomes.get(key);
        if (existing) {
          existing.venues = [...new Set([...existing.venues, venueMarket.venue])].sort();
          continue;
        }
        outcomes.set(key, {
          id: outcome.id,
          label: outcome.label,
          venues: [venueMarket.venue]
        });
      }
    }
    return reply.send({
      canonicalEventId: market.canonicalEventId,
      title: market.title,
      outcomes: [...outcomes.values()].sort((left, right) => left.label.localeCompare(right.label))
    });
  });

  app.post("/markets/quotes/batch", async (request, reply) => {
    if (!deps.marketDataViewService?.getBatchQuotes) {
      return reply.status(503).send({
        code: "MARKET_BATCH_QUOTES_UNAVAILABLE",
        message: "Live market batch quotes are not configured."
      });
    }
    const parsed = batchQuotesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MARKET_BATCH_QUOTE_REQUEST",
        message: "Market batch quote request validation failed.",
        details: parsed.error.flatten()
      });
    }
    return reply.send(await deps.marketDataViewService.getBatchQuotes({
      items: parsed.data.items.map((item) => ({
        marketId: item.marketId,
        outcomeId: item.outcomeId,
        ...(item.side ? { side: item.side } : {}),
        ...(item.amount !== undefined ? { amount: item.amount } : {})
      }))
    }));
  });

  app.get("/markets/:marketId/orderbook", async (request, reply) => {
    if (!deps.marketDataViewService) {
      return reply.status(503).send({
        code: "MARKET_ORDERBOOK_UNAVAILABLE",
        message: "Live market orderbook service is not configured."
      });
    }
    const parsed = orderbookQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MARKET_ORDERBOOK_QUERY",
        message: "Market orderbook query validation failed.",
        details: parsed.error.flatten()
      });
    }
    const { marketId } = request.params as { marketId: string };
    const marketResult = await resolveCachedCatalogMarketForChart(deps.marketCatalogRepository, marketId, deps.marketCatalogSnapshotCache);
    if (marketResult.ok && !marketResult.market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    touchOrderbookMarketActivity(marketId, marketResult, parsed.data.outcomeId, deps.marketActivityTracker);
    const response = await deps.marketDataViewService.getOrderbook({
      marketId,
      canonicalMarketIds: resolveOrderbookMarketIds(marketId, marketResult),
      ...(parsed.data.outcomeId ? { outcomeId: parsed.data.outcomeId } : {}),
      ...(parsed.data.depth ? { depth: parsed.data.depth } : {}),
      ...(parsed.data.venue ? { venue: parsed.data.venue } : {})
    });
    return reply.send({
      ...response,
      stream: buildOrderbookStreamContract(marketId, marketResult, parsed.data.outcomeId)
    });
  });

  app.get("/markets/:marketId/chart", async (request, reply) => {
    if (!deps.marketDataViewService) {
      return reply.status(503).send({
        code: "MARKET_CHART_UNAVAILABLE",
        message: "Live market chart service is not configured."
      });
    }
    const parsed = chartQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_MARKET_CHART_QUERY",
        message: "Market chart query validation failed.",
        details: parsed.error.flatten()
      });
    }
    const { marketId } = request.params as { marketId: string };
    const marketResult = await resolveCachedCatalogMarketForChart(deps.marketCatalogRepository, marketId, deps.marketCatalogSnapshotCache);
    if (marketResult.ok && !marketResult.market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    const market = marketResult.ok ? marketResult.market : null;
    const response = await deps.marketDataViewService.getChart({
      marketId,
      ...(parsed.data.outcomeId ? { outcomeId: parsed.data.outcomeId } : {}),
      ...(parsed.data.outcomeId && market ? { outcomeLabel: resolveOutcomeLabel(market, parsed.data.outcomeId) } : {}),
      canonicalEventId: market?.canonicalEventId ?? marketId,
      venueMarketIds: market?.venueMarkets.map((venueMarket) => venueMarket.venueMarketId) ?? [],
      venueMappings: market?.venueMarkets.map((venueMarket) => ({
        venue: venueMarket.venue,
        venueMarketId: venueMarket.venueMarketId
      })) ?? [],
      timeframe: parsed.data.timeframe as MarketChartTimeframe
    });
    return reply.send(response);
  });
};

const resolveOutcomeLabel = (
  market: Awaited<ReturnType<MarketCatalogRepository["getMarket"]>>,
  outcomeId: string
): string | undefined => {
  if (!market) return undefined;
  for (const venueMarket of market.venueMarkets) {
    const outcome = venueMarket.outcomes.find((entry) => entry.id === outcomeId);
    if (outcome) return outcome.label;
  }
  return undefined;
};

const touchMarketCatalogActivity = (
  markets: readonly MarketCatalogMarket[],
  tracker: MarketCatalogRouteDeps["marketActivityTracker"],
  maxMarkets: number = DEFAULT_MARKET_CATALOG_ACTIVITY_TOUCH_LIMIT
): void => {
  if (!tracker) {
    return;
  }
  const canonicalMarketIds = new Set(markets
    .slice(0, Math.max(0, maxMarkets))
    .flatMap((market) => market.canonicalMarketIds));
  for (const canonicalMarketId of canonicalMarketIds) {
    if (canonicalMarketId.trim().length === 0) {
      continue;
    }
    tracker.touch({ canonicalMarketId });
  }
};

const touchOrderbookMarketActivity = (
  marketId: string,
  marketResult: Awaited<ReturnType<typeof resolveCachedCatalogMarketForChart>>,
  outcomeId: string | undefined,
  tracker: MarketCatalogRouteDeps["marketActivityTracker"]
): void => {
  if (!tracker) {
    return;
  }
  const canonicalMarketIds = marketResult.ok && marketResult.market
    ? marketResult.market.canonicalMarketIds
    : [marketId];
  for (const canonicalMarketId of new Set(canonicalMarketIds)) {
    if (canonicalMarketId.trim().length === 0) {
      continue;
    }
    tracker.touch({
      canonicalMarketId,
      ...(outcomeId ? { canonicalOutcomeId: outcomeId } : {})
    });
  }
};

const queueMarketCatalogOrderbookWarmup = (
  payload: unknown,
  marketDataViewService: MarketCatalogRouteDeps["marketDataViewService"]
): void => {
  if (!marketDataViewService?.getOrderbook || typeof payload !== "object" || payload === null) {
    return;
  }
  const markets = Array.isArray((payload as { markets?: unknown }).markets)
    ? (payload as { markets: unknown[] }).markets
    : [];
  if (markets.length === 0) {
    return;
  }

  const now = Date.now();
  pruneMarketOrderbookWarmupCache(now);
  const tasks: Array<{ marketId: string; canonicalMarketIds: string[]; outcomeId: string }> = [];
  for (const market of markets) {
    if (tasks.length >= DEFAULT_MARKET_ORDERBOOK_WARMUP_LIMIT * MARKET_ORDERBOOK_WARMUP_OUTCOMES.length) {
      break;
    }
    if (!isMarketCatalogMarketLike(market) || !isTradableMarketListItem(market)) {
      continue;
    }
    const canonicalMarketIds = market.canonicalMarketIds
      .map((canonicalMarketId) => canonicalMarketId.trim())
      .filter((canonicalMarketId) => canonicalMarketId.length > 0);
    if (canonicalMarketIds.length === 0) {
      continue;
    }
    for (const outcomeId of MARKET_ORDERBOOK_WARMUP_OUTCOMES) {
      const key = marketOrderbookWarmupKey(market.canonicalEventId, canonicalMarketIds, outcomeId);
      const cachedUntil = marketOrderbookWarmupCache.get(key) ?? 0;
      if (cachedUntil > now) {
        continue;
      }
      marketOrderbookWarmupCache.set(key, now + MARKET_ORDERBOOK_WARMUP_CACHE_MS);
      tasks.push({
        marketId: market.canonicalEventId,
        canonicalMarketIds,
        outcomeId
      });
    }
  }

  if (tasks.length === 0) {
    return;
  }
  void runMarketCatalogOrderbookWarmup(marketDataViewService, tasks).catch(() => undefined);
};

const runMarketCatalogOrderbookWarmup = async (
  marketDataViewService: NonNullable<MarketCatalogRouteDeps["marketDataViewService"]>,
  tasks: readonly { marketId: string; canonicalMarketIds: readonly string[]; outcomeId: string }[]
): Promise<void> => {
  for (const task of tasks) {
    await marketDataViewService.getOrderbook({
      marketId: task.marketId,
      canonicalMarketIds: task.canonicalMarketIds,
      outcomeId: task.outcomeId
    });
  }
};

const marketOrderbookWarmupKey = (
  marketId: string,
  canonicalMarketIds: readonly string[],
  outcomeId: string
): string => `${marketId}\u0000${canonicalMarketIds.join("\u0001")}\u0000${outcomeId}`;

const pruneMarketOrderbookWarmupCache = (now: number): void => {
  for (const [key, expiresAtMs] of marketOrderbookWarmupCache.entries()) {
    if (expiresAtMs <= now) {
      marketOrderbookWarmupCache.delete(key);
    }
  }
};

const resolveOrderbookMarketIds = (
  marketId: string,
  marketResult: Awaited<ReturnType<typeof resolveCachedCatalogMarketForChart>>
): string[] => {
  const canonicalMarketIds = marketResult.ok && marketResult.market
    ? marketResult.market.canonicalMarketIds
    : [marketId];
  const normalized = [...new Set(canonicalMarketIds)]
    .map((canonicalMarketId) => canonicalMarketId.trim())
    .filter((canonicalMarketId) => canonicalMarketId.length > 0);
  return normalized.length > 0 ? normalized : [marketId];
};

const buildOrderbookStreamContract = (
  marketId: string,
  marketResult: Awaited<ReturnType<typeof resolveCachedCatalogMarketForChart>>,
  outcomeId: string | undefined
): { primaryTopic: string; topics: string[] } => {
  const canonicalMarketIds = marketResult.ok && marketResult.market
    ? marketResult.market.canonicalMarketIds
    : [marketId];
  const topics = [...new Set(canonicalMarketIds)]
    .filter((canonicalMarketId) => canonicalMarketId.trim().length > 0)
    .map((canonicalMarketId) => marketOrderbookTopic(canonicalMarketId, outcomeId));
  if (topics.length === 0) {
    const fallbackTopic = marketOrderbookTopic(marketId, outcomeId);
    return { primaryTopic: fallbackTopic, topics: [fallbackTopic] };
  }
  return {
    primaryTopic: topics[0]!,
    topics
  };
};

const enrichMarketsWithQuoteReadiness = async (
  markets: readonly MarketCatalogMarket[],
  source: MarketCatalogRouteDeps["marketQuoteReadinessSource"]
): Promise<{
  markets: MarketCatalogMarket[];
  degraded: boolean;
  reason?: "timeout" | "error";
}> => {
  if (!source || markets.length === 0) {
    return { markets: [...markets], degraded: false };
  }
  const canonicalMarketIds = [...new Set(markets.flatMap((market) => market.canonicalMarketIds))];
  const readinessResult = await withReadinessTimeout(
    source.listLatestMarketQuoteReadiness({ canonicalMarketIds }),
    resolveMarketQuoteReadinessTimeoutMs(process.env.MARKET_QUOTE_READINESS_TIMEOUT_MS)
  );
  if (!readinessResult.ok) {
    const cachedReadiness = readCachedMarketQuoteReadiness(canonicalMarketIds);
    if (cachedReadiness.length > 0) {
      const byCanonicalMarketId = new Map(cachedReadiness.map((item) => [item.canonicalMarketId, item]));
      return { markets: markets.map((market) => {
        const marketReadiness = market.canonicalMarketIds
          .map((canonicalMarketId) => byCanonicalMarketId.get(canonicalMarketId))
          .filter((item): item is MarketQuoteReadinessSnapshot => item !== undefined);
        return {
          ...market,
          ...aggregateMarketQuoteReadiness(marketReadiness)
        };
      }), degraded: true, reason: readinessResult.reason };
    }
    return {
      markets: markets.map((market) => ({
        ...market,
        quoteStatus: "unavailable",
        quoteReadyVenueCount: 0,
        quoteReadyVenues: [],
        quoteBlockers: [{
          venue: "SYSTEM",
          reason: readinessResult.reason === "timeout"
            ? "QUOTE_READINESS_SNAPSHOT_TIMEOUT"
            : "QUOTE_READINESS_SNAPSHOT_UNAVAILABLE"
        }],
        lastQuoteAt: null
      })),
      degraded: true,
      reason: readinessResult.reason
    };
  }
  const readiness = readinessResult.value;
  rememberMarketQuoteReadiness(readiness);
  const byCanonicalMarketId = new Map(readiness.map((item) => [item.canonicalMarketId, item]));
  return { markets: markets.map((market) => {
    const marketReadiness = market.canonicalMarketIds
      .map((canonicalMarketId) => byCanonicalMarketId.get(canonicalMarketId))
      .filter((item): item is MarketQuoteReadinessSnapshot => item !== undefined);
    return {
      ...market,
      ...aggregateMarketQuoteReadiness(marketReadiness)
    };
  }), degraded: false };
};

const rememberMarketQuoteReadiness = (readiness: readonly MarketQuoteReadinessSnapshot[]): void => {
  const staleUntilMs = Date.now() + resolveMarketQuoteReadinessStaleCacheMs(process.env.MARKET_QUOTE_READINESS_STALE_CACHE_MS);
  for (const snapshot of readiness) {
    marketQuoteReadinessCache.set(snapshot.canonicalMarketId, {
      snapshot,
      staleUntilMs
    });
  }
};

const readCachedMarketQuoteReadiness = (
  canonicalMarketIds: readonly string[]
): MarketQuoteReadinessSnapshot[] => {
  const now = Date.now();
  return [...new Set(canonicalMarketIds)]
    .flatMap((canonicalMarketId) => {
      const cached = marketQuoteReadinessCache.get(canonicalMarketId);
      if (!cached || cached.staleUntilMs < now) {
        marketQuoteReadinessCache.delete(canonicalMarketId);
        return [];
      }
      return [toStaleMarketQuoteReadiness(cached.snapshot)];
    });
};

const toStaleMarketQuoteReadiness = (
  snapshot: MarketQuoteReadinessSnapshot
): MarketQuoteReadinessSnapshot => ({
  ...snapshot,
  quoteStatus: snapshot.quoteReadyVenueCount > 0 ? "stale" : "unavailable"
});

const getCachedMarketCatalogResponse = async <T extends Record<string, unknown>>(
  key: string,
  producer: () => Promise<T>,
  options: {
    cacheDegraded?: boolean;
    sharedCache?: MarketCatalogSnapshotCache | undefined;
    sharedFallbacks?: readonly { key: string; limit: number }[] | undefined;
  } = {}
): Promise<T> => {
  const now = Date.now();
  const preferSharedCache = Boolean(options.sharedCache && isQuoteReadyMarketCatalogCacheKey(key));
  if (preferSharedCache) {
    const sharedValue = await getSharedMarketCatalogResponse<T>(key, options);
    if (sharedValue) {
      return sharedValue;
    }
  }
  const cached = marketCatalogResponseCache.get(key);
  if (cached && cached.expiresAtMs >= now) {
    const scrubbed = scrubMarketCatalogResponseForKey(key, cached.value as T);
    if (isCacheableMarketCatalogResponseForKey(key, scrubbed)) {
      return scrubbed;
    }
    marketCatalogResponseCache.delete(key);
  }
  const staleCached = cached && cached.staleUntilMs >= now
    ? scrubMarketCatalogResponseForKey(key, cached.value as T)
    : null;
  const usableStaleCached = staleCached && isCacheableMarketCatalogResponseForKey(key, staleCached)
    ? staleCached
    : null;
  const cacheTtlMs = resolveMarketCatalogResponseCacheMs(process.env.MARKET_CATALOG_RESPONSE_CACHE_MS);
  const staleCacheTtlMs = resolveMarketCatalogResponseStaleCacheMs(process.env.MARKET_CATALOG_RESPONSE_STALE_CACHE_MS);
  if (options.sharedCache && !preferSharedCache) {
    const sharedValue = await getSharedMarketCatalogResponse<T>(key, options, cacheTtlMs, staleCacheTtlMs);
    if (sharedValue) {
      return sharedValue;
    }
  }
  if (usableStaleCached) {
    if (!preferSharedCache && !marketCatalogResponsePending.has(key)) {
      const background = producer()
    .then((value) => {
      value = scrubMarketCatalogResponseForKey(key, value);
      if (options.cacheDegraded !== false || isCacheableMarketCatalogResponseForKey(key, value)) {
        cacheMarketCatalogResponse(key, value, cacheTtlMs, staleCacheTtlMs);
        void options.sharedCache?.set(key, value, cacheTtlMs).catch(() => undefined);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          marketCatalogResponsePending.delete(key);
        });
      marketCatalogResponsePending.set(key, background);
    }
    return markMarketCatalogResponseFromStaleCache(usableStaleCached);
  }
  const pending = marketCatalogResponsePending.get(key);
  if (pending) {
    return await pending as T;
  }
  const promise = producer()
    .then((value) => {
      value = scrubMarketCatalogResponseForKey(key, value);
      if (options.cacheDegraded !== false || isCacheableMarketCatalogResponseForKey(key, value)) {
        cacheMarketCatalogResponse(key, value, cacheTtlMs, staleCacheTtlMs);
        if (isCacheableMarketCatalogResponseForKey(key, value)) {
          void options.sharedCache?.set(key, value, cacheTtlMs).catch(() => undefined);
        }
      } else if (usableStaleCached) {
        return markMarketCatalogResponseFromStaleCache(usableStaleCached);
      }
      return value;
    })
    .catch((error) => {
      if (usableStaleCached) {
        return markMarketCatalogResponseFromStaleCache(usableStaleCached);
      }
      throw error;
    })
    .finally(() => {
      marketCatalogResponsePending.delete(key);
    });
  marketCatalogResponsePending.set(key, promise);
  return await promise;
};

const getSharedMarketCatalogResponse = async <T extends Record<string, unknown>>(
  key: string,
  options: {
    sharedCache?: MarketCatalogSnapshotCache | undefined;
    sharedFallbacks?: readonly { key: string; limit: number }[] | undefined;
  },
  cacheTtlMs = resolveMarketCatalogResponseCacheMs(process.env.MARKET_CATALOG_RESPONSE_CACHE_MS),
  staleCacheTtlMs = resolveMarketCatalogResponseStaleCacheMs(process.env.MARKET_CATALOG_RESPONSE_STALE_CACHE_MS)
): Promise<T | null> => {
  if (!options.sharedCache) {
    return null;
  }
  try {
    const candidates: T[] = [];
    const shared = await options.sharedCache.get<T>(key);
    if (shared && isCacheableMarketCatalogResponseForKey(key, shared)) {
      candidates.push(scrubMarketCatalogResponseForKey(key, shared));
    }
    for (const fallback of options.sharedFallbacks ?? []) {
      const fallbackShared = await options.sharedCache.get<T>(fallback.key);
      if (fallbackShared && isCacheableMarketCatalogResponseForKey(fallback.key, fallbackShared)) {
        const sliced = scrubMarketCatalogResponseForKey(key, sliceMarketCatalogResponse(fallbackShared, fallback.limit));
        if (isCacheableMarketCatalogResponseForKey(key, sliced)) {
          candidates.push(sliced);
        }
      }
    }
    const best = pickBestMarketCatalogResponse(candidates);
    if (best) {
      cacheMarketCatalogResponse(key, best, cacheTtlMs, staleCacheTtlMs);
      return best;
    }
  } catch {
    // Redis is a hot display cache only. Fall through to local cache/DB producer.
  }
  return null;
};

const markMarketCatalogResponseFromStaleCache = <T extends Record<string, unknown>>(value: T): T => ({
  ...value,
  quoteReadinessDegraded: true,
  quoteReadinessReason: "stale_cache"
});

const scrubMarketCatalogResponseForKey = <T extends Record<string, unknown>>(key: string, value: T): T => {
  if (!isQuoteReadyMarketCatalogCacheKey(key) || !Array.isArray(value.markets)) {
    return value;
  }
  const markets = value.markets.filter(isTradableMarketListItem);
  return {
    ...value,
    markets,
    count: markets.length
  };
};

const isTradableMarketListItem = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { quoteStatus?: unknown; quoteReadyVenueCount?: unknown; lastQuoteAt?: unknown };
  const quoteReadyVenueCount = typeof record.quoteReadyVenueCount === "number"
    ? record.quoteReadyVenueCount
    : typeof record.quoteReadyVenueCount === "string"
      ? Number(record.quoteReadyVenueCount)
      : 0;
  return quoteReadyVenueCount > 0
    && (record.quoteStatus === "live" || record.quoteStatus === "partial")
    && hasRecentQuoteTimestamp(record.lastQuoteAt);
};

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

const cacheMarketCatalogResponse = <T>(
  key: string,
  value: T,
  ttlMs: number,
  staleTtlMs: number
): void => {
  const now = Date.now();
  marketCatalogResponseCache.set(key, {
    value,
    expiresAtMs: now + ttlMs,
    staleUntilMs: now + staleTtlMs
  });
};

const isCacheableMarketCatalogResponse = (value: Record<string, unknown>): boolean => {
  if (value.quoteReadinessDegraded !== true) {
    return true;
  }
  const markets = Array.isArray(value.markets) ? value.markets : [];
  return markets.length > 0;
};

const isCacheableMarketCatalogResponseForKey = (
  key: string,
  value: Record<string, unknown>
): boolean => {
  if (!isCacheableMarketCatalogResponse(value)) {
    return false;
  }
  if (!isQuoteReadyMarketCatalogCacheKey(key)) {
    return true;
  }
  const markets = Array.isArray(value.markets) ? value.markets : [];
  return markets.some(isTradableMarketListItem);
};

const isQuoteReadyMarketCatalogCacheKey = (key: string): boolean =>
  key.startsWith("markets:") && key.includes("\"quoteReadyOnly\":true");

const marketCatalogSnapshotFallbacks = (
  query: z.infer<typeof listQuerySchema>
): { key: string; limit: number }[] => {
  const limit = query.limit ?? 80;
  const fallbacks = new Map<string, { key: string; limit: number }>();
  const add = (candidate: z.infer<typeof listQuerySchema>, candidateLimit = limit): void => {
    const key = `markets:${stableQueryCacheKey(candidate)}`;
    if (key !== `markets:${stableQueryCacheKey(query)}`) {
      fallbacks.set(key, { key, limit: candidateLimit });
    }
  };
  for (const alias of marketCatalogAllRouteAliases(query)) {
    add(alias);
  }
  if (query.category !== undefined || query.search !== undefined) {
    return [...fallbacks.values()];
  }
  const fallbackLimits = [80, 250].filter((fallbackLimit) => fallbackLimit > limit);
  for (const fallbackLimit of fallbackLimits) {
    add({ ...query, limit: fallbackLimit }, limit);
    for (const alias of marketCatalogAllRouteAliases({ ...query, limit: fallbackLimit })) {
      add(alias, limit);
    }
  }
  return [...fallbacks.values()];
};

const marketCatalogAllRouteAliases = (
  query: z.infer<typeof listQuerySchema>
): z.infer<typeof listQuerySchema>[] => {
  if (query.routeCoverage === undefined) {
    return [{ ...query, routeCoverage: "all" }];
  }
  if (query.routeCoverage !== "all") {
    return [];
  }
  const { routeCoverage: _routeCoverage, ...rest } = query;
  return [rest];
};

const pickBestMarketCatalogResponse = <T extends Record<string, unknown>>(values: readonly T[]): T | null => {
  let best: T | null = null;
  let bestCount = -1;
  for (const value of values) {
    const count = Array.isArray(value.markets)
      ? value.markets.length
      : typeof value.count === "number"
        ? value.count
        : 0;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

const sliceMarketCatalogResponse = <T extends Record<string, unknown>>(value: T, limit: number): T => {
  const markets = Array.isArray(value.markets) ? value.markets.slice(0, limit) : [];
  return {
    ...value,
    markets,
    count: markets.length
  };
};

const stableQueryCacheKey = (query: z.infer<typeof listQuerySchema>): string =>
  JSON.stringify(Object.keys(query)
    .sort()
    .reduce<Record<string, unknown>>((memo, key) => {
      const value = query[key as keyof typeof query];
      if (value !== undefined) {
        memo[key] = value;
      }
      return memo;
    }, {}));

const withReadinessTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" | "error" }> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      promise,
      new Promise<typeof MARKET_QUOTE_READINESS_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(MARKET_QUOTE_READINESS_TIMEOUT), timeoutMs);
      })
    ]);
    if (value === MARKET_QUOTE_READINESS_TIMEOUT) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const resolveMarketQuoteReadinessTimeoutMs = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MARKET_QUOTE_READINESS_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKET_QUOTE_READINESS_TIMEOUT_MS;
};

const resolveMarketQuoteReadinessStaleCacheMs = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MARKET_QUOTE_READINESS_STALE_CACHE_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKET_QUOTE_READINESS_STALE_CACHE_MS;
};

const resolveMarketCatalogResponseCacheMs = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MARKET_CATALOG_RESPONSE_CACHE_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKET_CATALOG_RESPONSE_CACHE_MS;
};

const resolveMarketCatalogResponseStaleCacheMs = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MARKET_CATALOG_RESPONSE_STALE_CACHE_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKET_CATALOG_RESPONSE_STALE_CACHE_MS;
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
    .flatMap((item) => item.quoteReadyVenues.length > 0
      ? item.quoteReadyVenues
      : item.quoteReadyVenueCount > 0
        ? item.quoteBlockers.length > 0 ? [] : ["UNKNOWN"]
        : [])
    .filter((venue) => venue !== "UNKNOWN")
    .map((venue) => venue.trim().toUpperCase()))].sort();
  const quoteReadyVenueCount = quoteReadyVenues.length > 0
    ? quoteReadyVenues.length
    : tradableReadiness.reduce((sum, item) => sum + item.quoteReadyVenueCount, 0);
  return {
    quoteStatus: pickMarketQuoteStatus(readiness),
    quoteReadyVenueCount,
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

const pickMarketQuoteStatus = (
  readiness: readonly MarketQuoteReadinessSnapshot[]
): MarketCatalogMarket["quoteStatus"] => {
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

const shouldOverfetchMarkets = (query: z.infer<typeof listQuerySchema>): boolean =>
  query.quoteReadyOnly === true || (query.routeCoverage !== undefined && query.routeCoverage !== "all");

const resolveMarketFetchLimit = (limit: number, query: z.infer<typeof listQuerySchema>): number =>
  shouldOverfetchMarkets(query)
    ? Math.min(
      Math.max(limit * DEFAULT_MARKET_LIST_OVERFETCH_MULTIPLIER, 250),
      DEFAULT_MARKET_LIST_OVERFETCH_CAP
    )
    : limit;

const routeCoverageMatches = (
  market: MarketCatalogMarket,
  routeCoverage: z.infer<typeof routeCoverageSchema>
): boolean => {
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

const resolveCachedCatalogMarket = async (
  repository: Pick<MarketCatalogRepository, "getMarket">,
  marketId: string,
  sharedCache?: MarketCatalogSnapshotCache | undefined
) => {
  const now = Date.now();
  const cached = marketDetailCache.get(marketId);
  if (cached && cached.expiresAtMs >= now) {
    return cached.value;
  }
  const pending = marketDetailPending.get(marketId);
  if (pending) {
    return await pending;
  }
  const promise = resolveCachedCatalogMarketUncoalesced(repository, marketId, sharedCache)
    .finally(() => {
      marketDetailPending.delete(marketId);
    });
  marketDetailPending.set(marketId, promise);
  return await promise;
};

const resolveCachedCatalogMarketForChart = async (
  repository: Pick<MarketCatalogRepository, "getMarket">,
  marketId: string,
  sharedCache?: MarketCatalogSnapshotCache | undefined
): Promise<
  | { ok: true; market: Awaited<ReturnType<MarketCatalogRepository["getMarket"]>> }
  | { ok: false; reason: "timeout" | "error" }
> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      resolveCachedCatalogMarket(repository, marketId, sharedCache),
      new Promise<typeof MARKET_DETAIL_TIMEOUT>((resolve) => {
        timeout = setTimeout(() => resolve(MARKET_DETAIL_TIMEOUT), DEFAULT_MARKET_CHART_DETAIL_TIMEOUT_MS);
      })
    ]);
    if (value === MARKET_DETAIL_TIMEOUT) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: true, market: value };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

interface MarketCatalogDetailSnapshot {
  market?: MarketCatalogMarket | null | undefined;
  materialized?: boolean | undefined;
  materializedAt?: string | undefined;
}

const resolveCachedCatalogMarketUncoalesced = async (
  repository: Pick<MarketCatalogRepository, "getMarket">,
  marketId: string,
  sharedCache?: MarketCatalogSnapshotCache | undefined
): Promise<MarketCatalogMarket | null> => {
  const cacheTtlMs = resolveMarketDetailCacheMs(process.env.MARKET_DETAIL_CACHE_MS);
  const shared = await readSharedMarketDetailSnapshot(sharedCache, marketId);
  if (shared !== undefined) {
    cacheMarketDetailLocally(marketId, shared, cacheTtlMs);
    return shared;
  }
  const value = await resolveCatalogMarket(repository, marketId);
  cacheMarketDetailLocally(marketId, value, cacheTtlMs);
  if (value && sharedCache) {
    void writeSharedMarketDetailSnapshots(sharedCache, value, cacheTtlMs).catch(() => undefined);
  }
  return value;
};

const readSharedMarketDetailSnapshot = async (
  sharedCache: MarketCatalogSnapshotCache | undefined,
  marketId: string
): Promise<MarketCatalogMarket | null | undefined> => {
  if (!sharedCache) {
    return undefined;
  }
  try {
    for (const key of marketDetailCandidateCacheKeys(marketId)) {
      const cached = await sharedCache.get<MarketCatalogDetailSnapshot | MarketCatalogMarket>(key);
      if (!cached) {
        continue;
      }
      const market = isMarketCatalogDetailSnapshot(cached) ? cached.market : cached;
      if (market === null || isMarketCatalogMarketLike(market)) {
        return market;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const writeSharedMarketDetailSnapshots = async (
  sharedCache: MarketCatalogSnapshotCache,
  market: MarketCatalogMarket,
  ttlMs: number
): Promise<void> => {
  const payload: MarketCatalogDetailSnapshot = {
    market,
    materialized: true,
    materializedAt: new Date().toISOString()
  };
  for (const key of marketCatalogDetailAliasKeys(market)) {
    await sharedCache.set(key, payload, ttlMs);
  }
};

const cacheMarketDetailLocally = (
  marketId: string,
  value: MarketCatalogMarket | null,
  ttlMs: number
): void => {
  marketDetailCache.set(marketId, {
    value,
    expiresAtMs: Date.now() + ttlMs
  });
  if (value) {
    for (const key of marketDetailLocalAliasIds(value)) {
      marketDetailCache.set(key, {
        value,
        expiresAtMs: Date.now() + ttlMs
      });
    }
  }
};

const marketDetailCandidateCacheKeys = (marketId: string): string[] =>
  marketDetailCandidateIds(marketId).map(marketCatalogDetailCacheKey);

const marketDetailCandidateIds = (marketId: string): string[] => {
  const aliases = new Set<string>();
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed) aliases.add(trimmed);
  };
  add(marketId);
  const decoded = safeDecodeURIComponent(marketId);
  add(decoded);
  for (const value of [marketId, decoded]) {
    const withoutVenueSuffix = value.replace(VENUE_SUFFIX_PATTERN, "");
    add(withoutVenueSuffix);
  }
  return [...aliases];
};

const marketDetailLocalAliasIds = (market: MarketCatalogMarket): string[] =>
  marketCatalogDetailAliasKeys(market).map((key) => key.replace(/^market-detail:/, ""));

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isMarketCatalogDetailSnapshot = (
  value: MarketCatalogDetailSnapshot | MarketCatalogMarket
): value is MarketCatalogDetailSnapshot =>
  Object.prototype.hasOwnProperty.call(value, "market");

const isMarketCatalogMarketLike = (value: unknown): value is MarketCatalogMarket =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { canonicalEventId?: unknown }).canonicalEventId === "string" &&
  Array.isArray((value as { canonicalMarketIds?: unknown }).canonicalMarketIds);

const resolveMarketDetailCacheMs = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MARKET_DETAIL_CACHE_MS;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MARKET_DETAIL_CACHE_MS;
};

const resolveCatalogMarket = async (
  repository: Pick<MarketCatalogRepository, "getMarket">,
  marketId: string
) => {
  const exact = await repository.getMarket(marketId);
  if (exact) return exact;

  const withoutVenueSuffix = marketId.replace(VENUE_SUFFIX_PATTERN, "");
  if (withoutVenueSuffix === marketId) return null;
  return repository.getMarket(withoutVenueSuffix);
};
