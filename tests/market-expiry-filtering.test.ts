import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { MarketCatalogRepository, SharedCoreQuoteMappingRepository } from "../src/repositories/market-catalog.repository.js";
import { MarketEventReviewRepository } from "../src/repositories/market-event-review.repository.js";

class CapturePool {
  public readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  public async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    return { rows: [] };
  }
}

const asPool = (pool: CapturePool): Pool => pool as unknown as Pool;

describe("market expiry filtering", () => {
  it("excludes past-expiry canonical events from market matching by default", async () => {
    const pool = new CapturePool();
    const repository = new MarketEventReviewRepository(asPool(pool));

    await repository.listCanonicalEvents();

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.sql).toContain("(ce.resolves_at IS NULL OR ce.resolves_at > NOW())");
    expect(pool.queries[0]?.sql).toContain("(ce.expires_at IS NULL OR ce.expires_at > NOW())");
  });

  it("keeps expired market matching rows only behind includeExpired", async () => {
    const pool = new CapturePool();
    const repository = new MarketEventReviewRepository(asPool(pool));

    await repository.listCanonicalEvents({ includeExpired: true });

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.sql).not.toContain("(ce.expires_at IS NULL OR ce.expires_at > NOW())");
  });

  it("excludes expired canonical and venue rows from normal catalog lists", async () => {
    const pool = new CapturePool();
    const repository = new MarketCatalogRepository(asPool(pool));

    await repository.listMarkets({ limit: 10 });

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.sql).toContain("(ce.resolves_at IS NULL OR ce.resolves_at > NOW())");
    expect(pool.queries[0]?.sql).toContain("(ce.expires_at IS NULL OR ce.expires_at > NOW())");
    expect(pool.queries[0]?.sql).toContain("FROM venue_market_profiles vmp_active");
    expect(pool.queries[0]?.sql).toContain("(vmp.expires_at IS NULL OR vmp.expires_at > NOW())");
  });

  it("preserves catalog diagnostic access to inactive rows", async () => {
    const pool = new CapturePool();
    const repository = new MarketCatalogRepository(asPool(pool));

    await repository.listMarkets({ includeInactive: true, limit: 10 });

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.sql).not.toContain("FROM venue_market_profiles vmp_active");
    expect(pool.queries[0]?.sql).not.toContain("(vmp.expires_at IS NULL OR vmp.expires_at > NOW())");
  });

  it("excludes expired markets from approved venue mapping reads", async () => {
    const pool = new CapturePool();
    const repository = new SharedCoreQuoteMappingRepository(asPool(pool));

    await repository.loadApprovedVenueMappings({ canonicalMarketId: "CRYPTO|BTC|2026-03-31" });

    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]?.sql).toContain("(ce.expires_at IS NULL OR ce.expires_at > NOW())");
    expect(pool.queries[0]?.sql).toContain("(vmp.expires_at IS NULL OR vmp.expires_at > NOW())");
  });
});
