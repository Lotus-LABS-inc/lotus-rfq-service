import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../../src/core/historical-simulation/historical-simulation.types.js";
import {
  SimulationAdminConflictError,
  SimulationAdminService,
  SimulationCanonicalCoverageNotFoundError
} from "../../src/api/admin/simulation-admin-service.js";

const canonicalEventId = "11111111-1111-4111-8111-111111111111";

describe("SimulationAdminService", () => {
  it("lists only persisted sports/crypto dual-venue scopes", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("GROUP BY canonical_event_id, canonical_category, market_class")) {
          return {
            rows: [{
              canonical_event_id: canonicalEventId,
              canonical_category: "SPORTS",
              market_class: "BINARY",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T01:00:00.000Z"),
              polymarket_rows: "12",
              limitless_rows: "9",
              venue_count: "2"
            }]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const service = new SimulationAdminService({
      pool,
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn() } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const scopes = await service.listScopes({ category: "SPORTS", marketClass: HistoricalMarketClass.BINARY });
    expect(scopes).toEqual([{
      canonicalEventId,
      canonicalCategory: "SPORTS",
      marketClass: HistoricalMarketClass.BINARY,
      venuePair: "POLYMARKET_LIMITLESS",
      coverageStart: new Date("2026-03-13T00:00:00.000Z"),
      coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
      venueCoverage: { polymarketRows: 12, limitlessRows: 9 }
    }]);
  });

  it("delegates run requests to the runner and injects strategy metadata", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("GROUP BY venue")) {
          return {
            rowCount: 2,
            rows: [
              {
                venue: "LIMITLESS",
                row_count: "8",
                coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                canonical_category: "SPORTS",
                market_class: "BINARY"
              },
              {
                venue: "POLYMARKET",
                row_count: "10",
                coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                canonical_category: "SPORTS",
                market_class: "BINARY"
              }
            ]
          };
        }

        if (sql.includes("SELECT DISTINCT ON (venue, venue_market_id)")) {
          return {
            rows: [
              {
                venue: "LIMITLESS",
                venue_market_id: "limitless-m1",
                orderbook_snapshot: { title: "Limitless Market 1" }
              },
              {
                venue: "POLYMARKET",
                venue_market_id: "polymarket-m1",
                orderbook_snapshot: { market_title: "Polymarket Market 1" }
              }
            ]
          };
        }

        if (sql.includes('SELECT DISTINCT "timestamp"')) {
          return {
            rows: [{ timestamp: new Date("2026-03-13T00:00:00.000Z") }]
          };
        }

        if (sql.includes("FROM historical_simulation_runs")) {
          return {
            rows: [{
              id: "run-1",
              qualification_run_id: null,
              scope_type: "CANONICAL_EVENT",
              scope_id: canonicalEventId,
              venue_pair: "POLYMARKET_LIMITLESS",
              market_class: "BINARY",
              started_at: new Date("2026-03-13T02:00:00.000Z"),
              ended_at: null,
              status: "RUNNING",
              metadata: { strategyKey: "strategy.sim.v1" }
            }]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const run = vi.fn(async (input) => ({
      runId: "run-1",
      dryRun: false,
      status: HistoricalSimulationRunStatus.RUNNING,
      sliceResults: [],
      sliceCount: 0,
      persistedResultCount: 0,
      blockedSliceCount: 0,
      metadata: input.metadata ?? {}
    }));

    const service = new SimulationAdminService({
      pool,
      historicalSimulationRunner: { run },
      resolutionRiskAdminService: {
        getCanonicalInspection: vi.fn(async () => ({
          canonicalEventId,
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 2,
            expectedPairCount: 1,
            persistedPairCount: 1,
            lastComputedAt: new Date("2026-03-13T01:30:00.000Z"),
            latestProfileUpdatedAt: new Date("2026-03-13T01:00:00.000Z"),
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        }))
      },
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const result = await service.runSimulation({
      marketClass: HistoricalMarketClass.BINARY,
      venuePair: "POLYMARKET_LIMITLESS",
      canonicalEventId,
      from: new Date("2026-03-13T00:00:00.000Z"),
      to: new Date("2026-03-13T01:00:00.000Z"),
      strategyKey: "strategy.sim.v1",
      dryRun: false
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalEventId,
        configVersion: "cfg-hist-v1",
        engineVersion: "eng-hist-v1",
        metadata: expect.objectContaining({
          strategyKey: "strategy.sim.v1"
        })
      })
    );
    expect(result.run?.id).toBe("run-1");

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    expect(coverage.pairedMarkets).toEqual([
      { venue: "LIMITLESS", venueMarketId: "limitless-m1", title: "Limitless Market 1" },
      { venue: "POLYMARKET", venueMarketId: "polymarket-m1", title: "Polymarket Market 1" }
    ]);
  });

  it("fails closed when canonical coverage is missing or scope resolution is ambiguous", async () => {
    const listScopesPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("GROUP BY canonical_event_id, canonical_category, market_class")) {
          return {
            rows: [
              {
                canonical_event_id: canonicalEventId,
                canonical_category: "SPORTS",
                market_class: "BINARY",
                coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                polymarket_rows: "4",
                limitless_rows: "4",
                venue_count: "2"
              },
              {
                canonical_event_id: "22222222-2222-4222-8222-222222222222",
                canonical_category: "CRYPTO",
                market_class: "BINARY",
                coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                polymarket_rows: "4",
                limitless_rows: "4",
                venue_count: "2"
              }
            ]
          };
        }

        if (sql.includes("GROUP BY venue")) {
          return { rowCount: 0, rows: [] };
        }

        if (sql.includes("SELECT DISTINCT ON (venue, venue_market_id)")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as unknown as Pool;

    const service = new SimulationAdminService({
      pool: listScopesPool,
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn() } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    await expect(
      service.runSimulation({
        marketClass: HistoricalMarketClass.BINARY,
        venuePair: "POLYMARKET_LIMITLESS",
        from: new Date("2026-03-13T00:00:00.000Z"),
        to: new Date("2026-03-13T01:00:00.000Z"),
        strategyKey: "strategy.sim.v1",
        dryRun: true
      })
    ).rejects.toBeInstanceOf(SimulationAdminConflictError);

    await expect(service.getCanonicalCoverage(canonicalEventId)).rejects.toBeInstanceOf(SimulationCanonicalCoverageNotFoundError);
  });
});
