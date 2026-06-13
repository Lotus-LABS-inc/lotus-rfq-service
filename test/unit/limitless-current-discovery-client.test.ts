import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { LimitlessCurrentDiscoveryClient } from "../../src/integrations/limitless/limitless-current-discovery-client.js";

const market = (id: number, slug: string, title: string) => ({
  id,
  conditionId: `0x${id.toString(16).padStart(64, "0")}`,
  description: `Rules for ${title}`,
  title,
  slug,
  status: "FUNDED",
  expired: false,
  hidden: false,
  categories: ["Crypto"],
  tags: ["Pre-TGE"],
  expirationTimestamp: Date.parse("2027-01-01T00:00:00.000Z"),
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  volume: "0",
  liquidity: "0",
  openInterest: "0",
  marketType: "single",
  tokens: {
    yes: `yes-${id}`,
    no: `no-${id}`
  }
});

const startLimitlessServer = async (handler: (url: URL) => unknown): Promise<{ server: Server; baseUrl: string }> => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      const payload = handler(url);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Test server did not bind a TCP port.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

describe("LimitlessCurrentDiscoveryClient", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
      server = null;
    }
  });

  it("pages active markets until the reported total is covered", async () => {
    const markets = [
      market(1, "alpha-fdv-above-dollar20m-one-day-after-launch", "Alpha FDV above $20M one day after launch?"),
      market(2, "alpha-fdv-above-dollar50m-one-day-after-launch", "Alpha FDV above $50M one day after launch?"),
      market(3, "alpha-fdv-above-dollar100m-one-day-after-launch", "Alpha FDV above $100M one day after launch?")
    ];
    const fixture = await startLimitlessServer((url) => {
      if (url.pathname === "/markets/active/slugs") {
        return markets.map((entry) => ({ slug: entry.slug, deadline: "2027-01-01T00:00:00.000Z" }));
      }
      if (url.pathname === "/markets/active") {
        const page = Number(url.searchParams.get("page") ?? "1");
        const limit = Number(url.searchParams.get("limit") ?? "25");
        return {
          data: markets.slice((page - 1) * limit, page * limit),
          totalMarketsCount: markets.length
        };
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });
    server = fixture.server;

    const result = await new LimitlessCurrentDiscoveryClient({
      baseUrl: fixture.baseUrl,
      pageSize: 2,
      maxPages: 10,
      requestTimeoutMs: 5_000
    }).listCurrentMarkets();

    expect(result.status).toBe("SUCCESS");
    expect(result.rows.map((row) => row.slug)).toEqual(markets.map((entry) => entry.slug));
  });

  it("uses active slugs plus market detail to fill rows missed by a capped browse window", async () => {
    const markets = [
      market(1, "beta-fdv-above-dollar20m-one-day-after-launch", "Beta FDV above $20M one day after launch?"),
      market(2, "beta-fdv-above-dollar50m-one-day-after-launch", "Beta FDV above $50M one day after launch?"),
      market(3, "beta-fdv-above-dollar100m-one-day-after-launch", "Beta FDV above $100M one day after launch?")
    ];
    const bySlug = new Map(markets.map((entry) => [entry.slug, entry]));
    const fixture = await startLimitlessServer((url) => {
      if (url.pathname === "/markets/active/slugs") {
        return markets.map((entry) => ({ slug: entry.slug, deadline: "2027-01-01T00:00:00.000Z" }));
      }
      if (url.pathname === "/markets/active") {
        return {
          data: markets.slice(0, 1),
          totalMarketsCount: markets.length
        };
      }
      const detailSlug = decodeURIComponent(url.pathname.replace(/^\/markets\//, ""));
      const detail = bySlug.get(detailSlug);
      if (detail) return detail;
      throw new Error(`Unexpected path ${url.pathname}`);
    });
    server = fixture.server;

    const result = await new LimitlessCurrentDiscoveryClient({
      baseUrl: fixture.baseUrl,
      pageSize: 1,
      maxPages: 1,
      maxMissingSlugDetails: 10,
      requestTimeoutMs: 5_000
    }).listCurrentMarkets();

    expect(result.rows.map((row) => row.slug).sort()).toEqual(markets.map((entry) => entry.slug).sort());
    expect(result.rows.filter((row) => row.sourceRef === "limitless_active_slug_detail")).toHaveLength(2);
  });
});
