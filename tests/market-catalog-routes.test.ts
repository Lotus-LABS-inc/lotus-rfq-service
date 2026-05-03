import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerMarketCatalogRoutes } from "../src/api/routes/markets.js";
import type {
  MarketCatalogCategory,
  MarketCatalogMarket,
  MarketCatalogRepository
} from "../src/repositories/market-catalog.repository.js";
import { MarketCatalogRepository as PgMarketCatalogRepository } from "../src/repositories/market-catalog.repository.js";

const market: MarketCatalogMarket = {
  canonicalEventId: "11111111-1111-5111-8111-111111111111",
  canonicalMarketIds: ["NOMINEE|US_PRESIDENT|2028|REPUBLICAN"],
  title: "Republican Presidential Nominee 2028",
  normalizedTitle: "2028 republican presidential nomination",
  category: "POLITICS",
  marketClass: "CATEGORICAL",
  status: "OPEN",
  startsAt: null,
  expiresAt: "2028-11-01T00:00:00.000Z",
  resolvesAt: null,
  venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
  venueCount: 3,
  venueMarketCount: 3,
  outcomeCount: 2,
  routeability: {
    hasSingleVenue: true,
    hasCrossVenue: true
  },
  venueMarkets: [{
    canonicalMarketId: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    canonicalMarketTitle: "Republican Presidential Nominee 2028",
    venue: "POLYMARKET",
    venueMarketProfileId: "vmp_poly",
    venueMarketId: "poly-1",
    venueTitle: "Republican nominee?",
    marketClass: "CATEGORICAL",
    outcomes: [{ id: "jd-vance", label: "JD Vance" }, { id: "donald-trump", label: "Donald Trump" }],
    network: "POLYGON",
    chain: "POLYGON",
    expiresAt: "2028-11-01T00:00:00.000Z",
    resolvesAt: null
  }],
  updatedAt: "2026-05-03T00:00:00.000Z"
};

class FakeMarketCatalogRepository implements Pick<MarketCatalogRepository, "listCategories" | "listMarkets" | "getMarket"> {
  public filters: unknown[] = [];

  public async listCategories(): Promise<MarketCatalogCategory[]> {
    return [{ category: "POLITICS", marketCount: 1 }];
  }

  public async listMarkets(filter = {}): Promise<MarketCatalogMarket[]> {
    this.filters.push(filter);
    return [market];
  }

  public async getMarket(marketId: string): Promise<MarketCatalogMarket | null> {
    return marketId === market.canonicalEventId || marketId === market.canonicalMarketIds[0] ? market : null;
  }
}

describe("market catalog routes", () => {
  it("lists normalized user-facing markets by category without raw venue internals", async () => {
    const app = Fastify({ logger: false });
    const repository = new FakeMarketCatalogRepository();
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: repository });

    const response = await app.inject({
      method: "GET",
      url: "/markets?category=politics&search=nominee&limit=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: 1,
      markets: [{
        title: "Republican Presidential Nominee 2028",
        category: "POLITICS",
        venues: ["LIMITLESS", "POLYMARKET", "PREDICT_FUN"],
        routeability: { hasCrossVenue: true }
      }]
    });
    expect(repository.filters[0]).toMatchObject({ category: "politics", search: "nominee", limit: 10 });
    expect(response.body).not.toContain("raw_source_payload");
    expect(response.body).not.toContain("apiKey");
    expect(response.body).not.toContain("privateKey");

    await app.close();
  });

  it("returns detail and normalized outcomes for a canonical market", async () => {
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: new FakeMarketCatalogRepository() });

    const detail = await app.inject({
      method: "GET",
      url: `/markets/${encodeURIComponent(market.canonicalMarketIds[0]!)}`
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().market.title).toBe("Republican Presidential Nominee 2028");

    const outcomes = await app.inject({
      method: "GET",
      url: `/markets/${market.canonicalEventId}/outcomes`
    });
    expect(outcomes.statusCode).toBe(200);
    expect(outcomes.json().outcomes.map((entry: { label: string }) => entry.label)).toEqual(["Donald Trump", "JD Vance"]);

    const missing = await app.inject({ method: "GET", url: "/markets/missing" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("lists categories across available canonical markets", async () => {
    const app = Fastify({ logger: false });
    await registerMarketCatalogRoutes(app, { marketCatalogRepository: new FakeMarketCatalogRepository() });

    const response = await app.inject({ method: "GET", url: "/markets/categories" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ categories: [{ category: "POLITICS", marketCount: 1 }] });

    await app.close();
  });

  it("treats epoch venue resolution timestamps as unset placeholders", async () => {
    const queries: unknown[] = [];
    const pool = {
      query: async (_sql: string, _params?: unknown[]) => {
        queries.push({ sql: _sql, params: _params });
        if (queries.length === 1) {
          return {
            rows: [{
              canonical_event_id: "11111111-1111-5111-8111-111111111112",
              proposition_key: "opinion-market-active",
              title: "Active Opinion Market",
              normalized_proposition_text: "active opinion market",
              canonical_category: "CRYPTO",
              market_class: "BINARY",
              starts_at: "2026-05-03T00:00:00.000Z",
              expires_at: "2028-05-10T00:00:00.000Z",
              resolves_at: "1970-01-01T00:00:00.000Z",
              updated_at: "2026-05-03T00:00:00.000Z",
              frontend_display_title: null,
              frontend_sort_priority: 1000,
              canonical_market_ids: ["opinion-market-active"],
              venues: ["OPINION"],
              venue_market_count: "1"
            }]
          };
        }
        return {
          rows: [{
            canonical_event_id: "11111111-1111-5111-8111-111111111112",
            canonical_market_id: "opinion-market-active",
            canonical_market_title: "Active Opinion Market",
            venue_market_profile_id: "vmp_opinion",
            venue: "OPINION",
            venue_market_id: "15525",
            venue_title: "Active Opinion Market",
            market_class: "BINARY",
            outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
            network: "BNB_MAINNET",
            chain: "BNB",
            expires_at: "2028-05-10T00:00:00.000Z",
            resolves_at: "1970-01-01T00:00:00.000Z"
          }]
        };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    const [activeMarket] = await repository.listMarkets({ limit: 1 });

    expect(activeMarket?.status).toBe("OPEN");
  });

  it("requires explicit frontend approval for public market list queries", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }
    };

    const repository = new PgMarketCatalogRepository(pool as never);
    await repository.listMarkets({ limit: 5 });
    await repository.listCategories();

    expect(queries[0]).toContain("fma.status = 'APPROVED'");
    expect(queries[1]).toContain("JOIN frontend_market_approvals fma");
    expect(queries[1]).toContain("fma.status = 'APPROVED'");
  });
});
