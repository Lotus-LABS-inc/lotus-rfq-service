import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS,
  VenueOrderbookSnapshotRepository,
  type VenueOrderbookSnapshotInput
} from "../src/repositories/venue-orderbook-snapshot.repository.js";

describe("VenueOrderbookSnapshotRepository", () => {
  it("preserves a fresh price-ready latest snapshot when a newer blocked snapshot is recorded", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const repository = new VenueOrderbookSnapshotRepository({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Pool);

    await repository.insertMany([snapshotFixture({ blockers: ["QUOTE_PROVIDER_HTTP_429"], bestBid: null, bestAsk: null })]);

    const latestUpsert = queries.find((query) => query.sql.includes("venue_orderbook_latest_snapshots"));

    expect(latestUpsert?.sql).toContain("COALESCE(jsonb_array_length(EXCLUDED.blockers), 0) = 0");
    expect(latestUpsert?.sql).toContain("venue_orderbook_latest_snapshots.received_at < now() - ($21::int * interval '1 millisecond')");
    expect(latestUpsert?.values).toHaveLength(21);
    expect(latestUpsert?.values[20]).toBe(DEFAULT_MARKET_CATALOG_DISPLAY_QUOTE_READINESS_MAX_AGE_MS);
  });

  it("bulk inserts history while deduping latest upsert keys", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const repository = new VenueOrderbookSnapshotRepository({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        return { rowCount: sql.includes("venue_orderbook_snapshots") ? 2 : 1, rows: [] };
      }
    } as unknown as Pool);

    await repository.insertMany([
      snapshotFixture({ receivedAt: new Date("2026-05-10T12:00:01.000Z"), bestBid: "0.49" }),
      snapshotFixture({ receivedAt: new Date("2026-05-10T12:00:02.000Z"), bestBid: "0.50" })
    ]);

    expect(queries).toHaveLength(2);
    const historicalInsert = queries[0]!;
    const latestUpsert = queries[1]!;
    expect(historicalInsert.sql).toContain("venue_orderbook_snapshots");
    expect(historicalInsert.sql).toContain("), (");
    expect(historicalInsert.values).toHaveLength(40);
    expect(latestUpsert.sql).toContain("venue_orderbook_latest_snapshots");
    expect(latestUpsert.sql).not.toContain("), (");
    expect(latestUpsert.values).toHaveLength(21);
    expect(latestUpsert.values[9]).toEqual(new Date("2026-05-10T12:00:02.000Z"));
  });
});

const snapshotFixture = (overrides: Partial<VenueOrderbookSnapshotInput> = {}): VenueOrderbookSnapshotInput => ({
  canonicalEventId: "event-1",
  canonicalMarketId: "market-1",
  canonicalOutcomeId: "YES",
  venue: "LIMITLESS",
  venueMarketId: "limitless-1",
  venueOutcomeId: "YES",
  source: "REST",
  quoteQuality: "FULL_DEPTH_REST",
  sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
  receivedAt: new Date("2026-05-10T12:00:01.000Z"),
  bestBid: "0.49",
  bestAsk: "0.51",
  midpoint: "0.50",
  spread: "0.02",
  bidDepth: "10",
  askDepth: "11",
  bids: [{ price: "0.49", size: "10" }],
  asks: [{ price: "0.51", size: "11" }],
  blockers: [],
  ...overrides
});
