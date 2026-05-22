import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MarketCatalogMarket, MarketCatalogRepository } from "../../repositories/market-catalog.repository.js";
import type { MarketQuoteReadinessSnapshot } from "../../repositories/venue-orderbook-snapshot.repository.js";
import type { LiveMarketDataViewService, MarketBatchQuoteResponse, MarketChartTimeframe } from "../../services/market-data-view.service.js";

const routeCoverageSchema = z.enum(["all", "single", "pair", "tri", "strict_all"]);

const listQuerySchema = z.object({
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  routeCoverage: routeCoverageSchema.optional(),
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

export interface MarketCatalogRouteDeps {
  marketCatalogRepository: Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "listEvents" | "getMarket" | "getEvent">;
  marketQuoteReadinessSource?: {
    listLatestMarketQuoteReadiness(input: {
      canonicalMarketIds: readonly string[];
      maxAgeMs?: number | undefined;
    }): Promise<MarketQuoteReadinessSnapshot[]>;
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
    const markets = await deps.marketCatalogRepository.listMarkets({
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.search !== undefined ? { search: parsed.data.search } : {}),
      ...(parsed.data.limit !== undefined ? { limit: shouldOverfetchMarkets(parsed.data) ? Math.min(parsed.data.limit * 3, 1000) : parsed.data.limit } : {})
    });
    const enrichedMarkets = await enrichMarketsWithQuoteReadiness(markets, deps.marketQuoteReadinessSource);
    const visibleMarkets = enrichedMarkets
      .filter((market) => !parsed.data.quoteReadyOnly || isQuoteReadyMarket(market))
      .filter((market) => routeCoverageMatches(market, parsed.data.routeCoverage ?? "all"))
      .slice(0, parsed.data.limit ?? enrichedMarkets.length);
    return reply.send({
      markets: visibleMarkets,
      count: visibleMarkets.length
    });
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
    const events = await deps.marketCatalogRepository.listEvents({
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.search !== undefined ? { search: parsed.data.search } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {})
    });
    return reply.send({
      events,
      count: events.length
    });
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
    const market = await resolveCatalogMarket(deps.marketCatalogRepository, marketId);
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
    const market = await resolveCatalogMarket(deps.marketCatalogRepository, marketId);
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
    const market = await resolveCatalogMarket(deps.marketCatalogRepository, marketId);
    if (!market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    const response = await deps.marketDataViewService.getOrderbook({
      marketId,
      ...(parsed.data.outcomeId ? { outcomeId: parsed.data.outcomeId } : {}),
      ...(parsed.data.depth ? { depth: parsed.data.depth } : {}),
      ...(parsed.data.venue ? { venue: parsed.data.venue } : {})
    });
    return reply.send(response);
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
    const market = await resolveCatalogMarket(deps.marketCatalogRepository, marketId);
    if (!market) {
      return reply.status(404).send({
        code: "MARKET_NOT_FOUND",
        message: "Market was not found."
      });
    }
    const response = await deps.marketDataViewService.getChart({
      marketId,
      ...(parsed.data.outcomeId ? { outcomeId: parsed.data.outcomeId } : {}),
      ...(parsed.data.outcomeId ? { outcomeLabel: resolveOutcomeLabel(market, parsed.data.outcomeId) } : {}),
      canonicalEventId: market.canonicalEventId,
      venueMarketIds: market.venueMarkets.map((venueMarket) => venueMarket.venueMarketId),
      venueMappings: market.venueMarkets.map((venueMarket) => ({
        venue: venueMarket.venue,
        venueMarketId: venueMarket.venueMarketId
      })),
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

const enrichMarketsWithQuoteReadiness = async (
  markets: readonly MarketCatalogMarket[],
  source: MarketCatalogRouteDeps["marketQuoteReadinessSource"]
): Promise<MarketCatalogMarket[]> => {
  if (!source || markets.length === 0) {
    return [...markets];
  }
  const canonicalMarketIds = [...new Set(markets.flatMap((market) => market.canonicalMarketIds))];
  const readiness = await source.listLatestMarketQuoteReadiness({ canonicalMarketIds });
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
  const quoteReadyVenues = [...new Set(readiness
    .flatMap((item) => item.quoteReadyVenues.length > 0
      ? item.quoteReadyVenues
      : item.quoteReadyVenueCount > 0
        ? item.quoteBlockers.length > 0 ? [] : ["UNKNOWN"]
        : [])
    .filter((venue) => venue !== "UNKNOWN")
    .map((venue) => venue.trim().toUpperCase()))].sort();
  const quoteReadyVenueCount = quoteReadyVenues.length > 0
    ? quoteReadyVenues.length
    : readiness.reduce((sum, item) => sum + item.quoteReadyVenueCount, 0);
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
  const statuses = new Set(readiness.map((item) => item.quoteStatus));
  if (statuses.has("live")) return "live";
  if (statuses.has("partial")) return "partial";
  if (statuses.has("stale")) return "stale";
  return "unavailable";
};

const isQuoteReadyMarket = (market: MarketCatalogMarket): boolean =>
  (market.quoteReadyVenueCount ?? 0) > 0 && market.quoteStatus !== "unavailable";

const shouldOverfetchMarkets = (query: z.infer<typeof listQuerySchema>): boolean =>
  query.quoteReadyOnly === true || (query.routeCoverage !== undefined && query.routeCoverage !== "all");

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
