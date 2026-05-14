import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MarketCatalogRepository } from "../../repositories/market-catalog.repository.js";
import type { LiveMarketDataViewService, MarketBatchQuoteResponse, MarketChartTimeframe } from "../../services/market-data-view.service.js";

const listQuerySchema = z.object({
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional()
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

export interface MarketCatalogRouteDeps {
  marketCatalogRepository: Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "listEvents" | "getMarket" | "getEvent">;
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
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {})
    });
    return reply.send({
      markets,
      count: markets.length
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
    const market = await deps.marketCatalogRepository.getMarket(marketId);
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
    const market = await deps.marketCatalogRepository.getMarket(marketId);
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
    const market = await deps.marketCatalogRepository.getMarket(marketId);
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
    const market = await deps.marketCatalogRepository.getMarket(marketId);
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
