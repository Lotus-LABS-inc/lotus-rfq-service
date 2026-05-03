import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MarketCatalogRepository } from "../../repositories/market-catalog.repository.js";

const listQuerySchema = z.object({
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export interface MarketCatalogRouteDeps {
  marketCatalogRepository: Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "getMarket">;
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
};
