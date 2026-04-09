import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../../src/core/historical-simulation/historical-simulation.types.js";
import {
  SimulationAdminConflictError,
  SimulationAdminService,
  SimulationCanonicalCoverageNotFoundError
} from "../../src/api/admin/simulation-admin-service.js";
import type { ResolutionEquivalenceClass } from "../../src/core/rfq-engine/resolution-risk.types.js";

const canonicalEventId = "11111111-1111-4111-8111-111111111111";

const buildInspection = (options?: {
  eventId?: string;
  includeOpinion?: boolean;
  includeLegacy?: boolean;
  includePredict?: boolean;
}) => {
  const eventId = options?.eventId ?? canonicalEventId;
  const includeOpinion = options?.includeOpinion ?? false;
  const includeLegacy = options?.includeLegacy ?? false;
  const includePredict = options?.includePredict ?? false;
  const profiles = [
    {
      id: "profile-limitless",
      venue: "LIMITLESS",
      venueMarketId: "limitless-m1",
      canonicalEventId: eventId,
      canonicalMarketId: "MARKET-1",
      updatedAt: new Date("2026-03-13T01:00:00.000Z")
    },
    {
      id: "profile-polymarket",
      venue: "POLYMARKET",
      venueMarketId: "polymarket-m1",
      canonicalEventId: eventId,
      canonicalMarketId: "MARKET-1",
      updatedAt: new Date("2026-03-13T01:00:00.000Z")
    },
    ...(includeOpinion
      ? [{
          id: "profile-opinion",
          venue: "OPINION",
          venueMarketId: "opinion-m1",
          canonicalEventId: eventId,
          canonicalMarketId: "MARKET-1",
          updatedAt: new Date("2026-03-13T01:00:00.000Z")
        }]
      : []),
    ...(includePredict
      ? [{
          id: "profile-predict",
          venue: "PREDICT",
          venueMarketId: "predict-m1",
          canonicalEventId: eventId,
          canonicalMarketId: "MARKET-1",
          updatedAt: new Date("2026-03-13T01:00:00.000Z")
        }]
      : []),
    ...(includeLegacy
      ? [{
          id: "profile-legacy",
          venue: "POLYMARKET",
          venueMarketId: "polymarket-legacy",
          canonicalEventId: eventId,
          canonicalMarketId: "MARKET-LEGACY",
          updatedAt: new Date("2026-03-13T01:00:00.000Z")
        }]
      : [])
  ];

  const assessments = [
    {
      id: "assessment-pl",
      canonicalEventId: eventId,
      canonicalMarketId: "MARKET-1",
      marketAProfileId: "profile-limitless",
      marketBProfileId: "profile-polymarket",
      equivalenceClass: "SAFE_EQUIVALENT" as ResolutionEquivalenceClass,
      factorBreakdown: {},
      version: "resolution-risk-v1",
      computedAt: new Date("2026-03-13T01:30:00.000Z")
    },
    ...(includeOpinion
      ? [
          {
            id: "assessment-po",
            canonicalEventId: eventId,
            canonicalMarketId: "MARKET-1",
            marketAProfileId: "profile-opinion",
            marketBProfileId: "profile-polymarket",
            equivalenceClass: "SAFE_EQUIVALENT" as ResolutionEquivalenceClass,
            factorBreakdown: {},
            version: "resolution-risk-v1",
            computedAt: new Date("2026-03-13T01:30:00.000Z")
          },
          {
            id: "assessment-lo",
            canonicalEventId: eventId,
            canonicalMarketId: "MARKET-1",
            marketAProfileId: "profile-limitless",
            marketBProfileId: "profile-opinion",
            equivalenceClass: "EQUIVALENT_WITH_LAG" as ResolutionEquivalenceClass,
            factorBreakdown: {},
            version: "resolution-risk-v1",
            computedAt: new Date("2026-03-13T01:30:00.000Z")
          }
        ]
      : [])
    ,
    ...(includePredict
      ? [{
          id: "assessment-pp",
          canonicalEventId: eventId,
          canonicalMarketId: "MARKET-1",
          marketAProfileId: "profile-predict",
          marketBProfileId: "profile-polymarket",
          equivalenceClass: "SAFE_EQUIVALENT" as ResolutionEquivalenceClass,
          factorBreakdown: {},
          version: "resolution-risk-v1",
          computedAt: new Date("2026-03-13T01:30:00.000Z")
        }]
      : [])
  ];

  return {
    canonicalEventId: eventId,
    profiles,
    assessments,
    scoringVersion: "resolution-risk-v1",
    freshness: {
      profileCount: profiles.length,
      expectedPairCount: profiles.length < 2 ? 0 : (profiles.length * (profiles.length - 1)) / 2,
      persistedPairCount: assessments.length,
      lastComputedAt: new Date("2026-03-13T01:30:00.000Z"),
      latestProfileUpdatedAt: new Date("2026-03-13T01:00:00.000Z"),
      isComplete: !includeLegacy,
      isStale: false,
      hasMixedVersions: false
    }
  };
};

const buildPool = (options?: {
  includeOpinion?: boolean;
  includeLegacy?: boolean;
  eventId?: string;
  includePredict?: boolean;
}) => {
  const eventId = options?.eventId ?? canonicalEventId;
  const includeOpinion = options?.includeOpinion ?? false;
  const includeLegacy = options?.includeLegacy ?? false;
  const includePredict = options?.includePredict ?? false;

  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("GROUP BY canonical_event_id, canonical_category, market_class")) {
        return {
          rows: [{
            canonical_event_id: eventId,
            canonical_category: includeOpinion ? "POLITICS" : "SPORTS",
            market_class: "BINARY"
          }]
        };
      }

      if (sql.includes("SELECT venue_market_id AS market_id")) {
        return {
          rows: includePredict
            ? [{
                market_id: "predict-m1",
                row_count: "3",
                coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                coverage_end: new Date("2026-03-13T01:00:00.000Z")
              }]
            : []
        };
      }

      if (sql.includes("FROM canonical_executable_market_members")) {
        return {
          rows: [
            {
              canonical_market_id: "MARKET-1",
              venue: "LIMITLESS",
              venue_market_id: "limitless-m1"
            },
            {
              canonical_market_id: "MARKET-1",
              venue: "POLYMARKET",
              venue_market_id: "polymarket-m1"
            },
            ...(includePredict
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue: "PREDICT",
                  venue_market_id: "predict-m1"
                }]
              : []),
            ...(includeOpinion
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue: "OPINION",
                  venue_market_id: "opinion-m1"
                }]
              : []),
            ...(includeLegacy
              ? [{
                  canonical_market_id: "MARKET-LEGACY",
                  venue: "POLYMARKET",
                  venue_market_id: "polymarket-legacy"
                }]
              : [])
          ]
        };
      }

      if (sql.includes("GROUP BY venue")) {
        const scopedMarketId = params?.[1];
        if (scopedMarketId === "MARKET-LEGACY") {
          return {
            rowCount: 1,
            rows: [{
              venue: "POLYMARKET",
              row_count: "1",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T00:00:00.000Z"),
              canonical_category: "CRYPTO",
              market_class: "BINARY"
            }]
          };
        }

        return {
          rowCount: includeOpinion ? 3 : includePredict ? 3 : 2,
          rows: [
            {
              venue: "LIMITLESS",
              row_count: "8",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T01:00:00.000Z"),
              canonical_category: includeOpinion ? "POLITICS" : "SPORTS",
              market_class: "BINARY"
            },
            {
              venue: "POLYMARKET",
              row_count: includeLegacy && !scopedMarketId ? "11" : "10",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T01:00:00.000Z"),
              canonical_category: includeOpinion ? "POLITICS" : "SPORTS",
              market_class: "BINARY"
            },
            ...(includePredict
              ? [{
                  venue: "PREDICT",
                  row_count: "3",
                  coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                  coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                  canonical_category: "SPORTS",
                  market_class: "BINARY"
                }]
              : []),
            ...(includeOpinion
              ? [{
                  venue: "OPINION",
                  row_count: "7",
                  coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                  coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                  canonical_category: "POLITICS",
                  market_class: "BINARY"
                }]
              : [])
          ]
        };
      }

      if (sql.includes("SELECT DISTINCT ON (venue, venue_market_id)")) {
        if (params?.[1] === "MARKET-LEGACY") {
          return {
            rows: [{
              venue: "POLYMARKET",
              venue_market_id: "polymarket-legacy",
              canonical_market_id: "MARKET-LEGACY",
              orderbook_snapshot: { market_title: "Legacy market" }
            }]
          };
        }

        return {
          rows: [
            {
              venue: "LIMITLESS",
              venue_market_id: "limitless-m1",
              canonical_market_id: "MARKET-1",
              orderbook_snapshot: { title: "Limitless Market 1" }
            },
            {
              venue: "POLYMARKET",
              venue_market_id: "polymarket-m1",
              canonical_market_id: "MARKET-1",
              orderbook_snapshot: { market_title: "Polymarket Market 1" }
            },
            ...(includePredict
              ? [{
                  venue: "PREDICT",
                  venue_market_id: "predict-m1",
                  canonical_market_id: "MARKET-1",
                  orderbook_snapshot: { title: "Predict Market 1", environment: "mainnet" }
                }]
              : []),
            ...(includeOpinion
              ? [{
                  venue: "OPINION",
                  venue_market_id: "opinion-m1",
                  canonical_market_id: "MARKET-1",
                  orderbook_snapshot: { title: "Opinion Market 1" }
                }]
              : [])
          ]
        };
      }

      if (sql.includes("SELECT DISTINCT ON (canonical_market_id, venue, venue_market_id)")) {
        return {
          rows: [
            {
              canonical_market_id: "MARKET-1",
              venue: "LIMITLESS",
              venue_market_id: "limitless-m1",
              orderbook_snapshot: { title: "Limitless Market 1" }
            },
            {
              canonical_market_id: "MARKET-1",
              venue: "POLYMARKET",
              venue_market_id: "polymarket-m1",
              orderbook_snapshot: { market_title: "Polymarket Market 1" }
            },
            ...(includePredict
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue: "PREDICT",
                  venue_market_id: "predict-m1",
                  orderbook_snapshot: { title: "Predict Market 1", environment: "mainnet" }
                }]
              : []),
            ...(includeOpinion
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue: "OPINION",
                  venue_market_id: "opinion-m1",
                  orderbook_snapshot: { title: "Opinion Market 1" }
                }]
              : []),
            ...(includeLegacy
              ? [{
                  canonical_market_id: "MARKET-LEGACY",
                  venue: "POLYMARKET",
                  venue_market_id: "polymarket-legacy",
                  orderbook_snapshot: { market_title: "Legacy market" }
                }]
              : [])
          ]
        };
      }

      if (sql.includes("GROUP BY canonical_market_id, venue_market_id, venue")) {
        return {
          rows: [
            {
              canonical_market_id: "MARKET-1",
              venue_market_id: "limitless-m1",
              venue: "LIMITLESS",
              row_count: "8",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T01:00:00.000Z"),
              canonical_category: includeOpinion ? "POLITICS" : "SPORTS",
              market_class: "BINARY"
            },
            {
              canonical_market_id: "MARKET-1",
              venue_market_id: "polymarket-m1",
              venue: "POLYMARKET",
              row_count: "10",
              coverage_start: new Date("2026-03-13T00:00:00.000Z"),
              coverage_end: new Date("2026-03-13T01:00:00.000Z"),
              canonical_category: includeOpinion ? "POLITICS" : "SPORTS",
              market_class: "BINARY"
            },
            ...(includePredict
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue_market_id: "predict-m1",
                  venue: "PREDICT",
                  row_count: "3",
                  coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                  coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                  canonical_category: "SPORTS",
                  market_class: "BINARY"
                }]
              : []),
            ...(includeOpinion
              ? [{
                  canonical_market_id: "MARKET-1",
                  venue_market_id: "opinion-m1",
                  venue: "OPINION",
                  row_count: "7",
                  coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                  coverage_end: new Date("2026-03-13T01:00:00.000Z"),
                  canonical_category: "POLITICS",
                  market_class: "BINARY"
                }]
              : []),
            ...(includeLegacy
              ? [{
                  canonical_market_id: "MARKET-LEGACY",
                  venue_market_id: "polymarket-legacy",
                  venue: "POLYMARKET",
                  row_count: "1",
                  coverage_start: new Date("2026-03-13T00:00:00.000Z"),
                  coverage_end: new Date("2026-03-13T00:00:00.000Z"),
                  canonical_category: "CRYPTO",
                  market_class: "BINARY"
                }]
              : [])
          ]
        };
      }

      if (sql.includes('SELECT DISTINCT "timestamp"')) {
        return {
          rows: [{ timestamp: new Date("2026-03-13T00:00:00.000Z") }]
        };
      }

      if (sql.includes("FROM predict_market_metadata")) {
        return {
          rows: includePredict
            ? [{
                market_id: "predict-m1",
                row_count: "1",
                environments: ["mainnet"]
              }]
            : []
        };
      }

      if (sql.includes("FROM predict_orderbook_snapshots")) {
        return { rows: [] };
      }

      if (sql.includes("FROM predict_match_events")) {
        return { rows: [] };
      }

      if (sql.includes("FROM predict_recorder_checkpoints")) {
        return { rows: [] };
      }

      if (sql.includes("FROM predict_fallback_historical_snapshots")) {
        return { rows: [] };
      }

      if (sql.includes("FROM predict_fallback_coverage_scans")) {
        return { rows: [] };
      }

      if (sql.includes("FROM historical_simulation_runs")) {
        return {
          rows: [{
            id: "run-1",
            qualification_run_id: null,
            scope_type: "CANONICAL_EVENT",
            scope_id: eventId,
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
};

describe("SimulationAdminService", () => {
  it("lists only exact markets runnable for the requested route mode", async () => {
    const service = new SimulationAdminService({
      pool: buildPool(),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const scopes = await service.listScopes({ category: "SPORTS", marketClass: HistoricalMarketClass.BINARY });
    expect(scopes).toEqual([{
      canonicalEventId,
      catalogScope: "live",
      canonicalCategory: "SPORTS",
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS",
      coverageStart: new Date("2026-03-13T00:00:00.000Z"),
      coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
      routeableMarketCount: 1,
      venueCoverage: { polymarketRows: 10, limitlessRows: 8, opinionRows: 0, myriadRows: 0, predictRows: 0 }
    }]);
  });

  it("filters runnable scopes by catalog scope", async () => {
    const liveService = new SimulationAdminService({
      pool: buildPool(),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    await expect(
      liveService.listScopes({
        category: "SPORTS",
        marketClass: HistoricalMarketClass.BINARY,
        catalogScope: "historical_simulation"
      })
    ).resolves.toEqual([]);

    const historicalService = new SimulationAdminService({
      pool: buildPool(),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => true),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const scopes = await historicalService.listScopes({
      category: "SPORTS",
      marketClass: HistoricalMarketClass.BINARY,
      catalogScope: "historical_simulation"
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.catalogScope).toBe("historical_simulation");
  });

  it("lists tri-venue scopes only when all three exact-market edges are safe", async () => {
    const service = new SimulationAdminService({
      pool: buildPool({ includeOpinion: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const scopes = await service.listScopes({
      category: "POLITICS",
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS_OPINION"
    });

    expect(scopes).toEqual([{
      canonicalEventId,
      catalogScope: "live",
      canonicalCategory: "POLITICS",
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS_OPINION",
      coverageStart: new Date("2026-03-13T00:00:00.000Z"),
      coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
      routeableMarketCount: 1,
      venueCoverage: { polymarketRows: 10, limitlessRows: 8, opinionRows: 7, myriadRows: 0, predictRows: 0 }
    }]);
  });

  it("derives Opinion exactness from canonical promoted overlap before legacy curation fallback", async () => {
    const service = new SimulationAdminService({
      pool: buildPool({ includeOpinion: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    const market = coverage.canonicalMarkets.find((entry) => entry.canonicalMarketId === "MARKET-1");

    expect(market?.opinionExactMatch).toEqual({
      classification: "semantic_exact_historical_qualified",
      historicalQualified: true,
      reason: "canonical_promoted_overlap"
    });
    expect(market?.routeModes.find((route) => route.routeMode === "POLYMARKET_OPINION")).toEqual(
      expect.objectContaining({
        runnable: true
      })
    );
  });

  it("delegates run requests with route-mode and resolved canonical market metadata", async () => {
    const pool = buildPool();
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
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const result = await service.runSimulation({
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS",
      canonicalEventId,
      side: "BUY",
      requestedNotional: "100",
      from: new Date("2026-03-13T00:00:00.000Z"),
      to: new Date("2026-03-13T01:00:00.000Z"),
      strategyKey: "strategy.sim.v1",
      dryRun: false
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      canonicalEventId,
      canonicalMarketId: "MARKET-1",
      routeMode: "POLYMARKET_LIMITLESS",
      metadata: expect.objectContaining({
        strategyKey: "strategy.sim.v1",
        requestedRouteMode: "POLYMARKET_LIMITLESS",
        catalogScope: "live"
      })
    }));
    expect(result.run?.routeMode).toBe("POLYMARKET_LIMITLESS");

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    expect(coverage.catalogScope).toBe("live");
    expect(coverage.hasTriVenueRoute).toBe(false);
    expect(coverage.routeModeSummary.find((entry) => entry.routeMode === "POLYMARKET_LIMITLESS")?.routeableMarketCount).toBe(1);
    expect(coverage.canonicalMarkets[0]).toEqual(expect.objectContaining({
      canonicalMarketId: "MARKET-1",
      runnableRouteModes: expect.arrayContaining(["POLYMARKET_ONLY", "LIMITLESS_ONLY", "POLYMARKET_LIMITLESS"])
    }));
  });

  it("keeps Predict current-state-only markets out of pair-route promotion while leaving Predict-only conservative", async () => {
    const service = new SimulationAdminService({
      pool: buildPool({ includePredict: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ includePredict: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ includePredict: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    const market = coverage.canonicalMarkets.find((entry) => entry.canonicalMarketId === "MARKET-1");

    expect(market?.predictReadiness).toEqual(expect.objectContaining({
      state: "CURRENT_STATE_ONLY",
      historicalQualified: false,
      currentStateRowCount: 3
    }));
    expect(market?.routeModes.find((route) => route.routeMode === "PREDICT_ONLY")).toEqual(
      expect.objectContaining({ runnable: true })
    );
    expect(market?.routeModes.find((route) => route.routeMode === "POLYMARKET_PREDICT")).toEqual(
      expect.objectContaining({
        runnable: false,
        reason: "predict_historically_unqualified"
      })
    );
    expect(coverage.predictReadinessOverview).toEqual(expect.objectContaining({
      state: "CURRENT_STATE_ONLY",
      historicalQualified: false,
      currentStateOnlyMarkets: 1
    }));
  });

  it("builds routeability summary with Opinion inventory rollups", async () => {
    const service = new SimulationAdminService({
      pool: buildPool({ includeOpinion: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ includeOpinion: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const summary = await service.getRouteabilitySummary({
      category: "POLITICS",
      marketClass: HistoricalMarketClass.BINARY
    });

    expect(summary.filters).toEqual({
      category: "POLITICS",
      catalogScope: "ALL",
      marketClass: HistoricalMarketClass.BINARY
    });
    expect(summary.totals.eventCount).toBe(1);
    expect(summary.venueVisibility.opinionEvents).toBe(1);
    expect(summary.opinionRouteability).toEqual(expect.objectContaining({
      eventsWithOpinionInventory: 1,
      eventsWithRunnableOpinionOnly: 1,
      eventsWithBlockedOpinionPairOrTri: 1,
      exactLiveOnlyCount: expect.any(Number),
      exactHistoricalQualifiedCount: expect.any(Number),
      nearMissCount: expect.any(Number),
      dominantNearMissReasons: expect.any(Array)
    }));
    expect(summary.routeModes.find((entry) => entry.routeMode === "POLYMARKET_LIMITLESS_OPINION")).toEqual(
      expect.objectContaining({
        routeableMarketCount: 1,
        eventCount: 1
      })
    );
  });

  it("treats sub-second resolution-risk skew as fresh for canonical promoted Opinion pairs", async () => {
    const inspection = buildInspection({ includeOpinion: true });
    for (const profile of inspection.profiles) {
      if (profile.canonicalMarketId === "MARKET-1") {
        profile.updatedAt = new Date("2026-03-13T01:30:00.060Z");
      }
    }
    for (const assessment of inspection.assessments) {
      if (assessment.canonicalMarketId === "MARKET-1") {
        assessment.computedAt = new Date("2026-03-13T01:30:00.000Z");
      }
    }

    const service = new SimulationAdminService({
      pool: buildPool({ includeOpinion: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => inspection) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => inspection)
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const coverage = await service.getCanonicalCoverage(canonicalEventId);
    const market = coverage.canonicalMarkets.find((entry) => entry.canonicalMarketId === "MARKET-1");

    expect(coverage.resolutionRiskInspection.freshness.isStale).toBe(false);
    expect(market?.routeModes.find((route) => route.routeMode === "POLYMARKET_OPINION")).toEqual(
      expect.objectContaining({
        runnable: true
      })
    );
  });

  it("builds routeability summary with blocked Predict category readiness", async () => {
    const service = new SimulationAdminService({
      pool: buildPool({ includePredict: true }),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ includePredict: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ includePredict: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    const summary = await service.getRouteabilitySummary({
      category: "SPORTS",
      marketClass: HistoricalMarketClass.BINARY
    });

    expect(summary.venueVisibility.predictEvents).toBe(1);
    expect(summary.predictRouteability).toEqual(expect.objectContaining({
      eventsWithPredictInventory: 1,
      eventsWithCurrentStateOnlyPredict: 1,
      eventsWithHistoricallyQualifiedPredict: 0,
      eventsWithBlockedPredictRoutes: 1
    }));
    expect(summary.predictRouteability.dominantBlockReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "predict_historically_unqualified"
        })
      ])
    );
  });

  it("fails closed when scope resolution is ambiguous or coverage is missing", async () => {
    const service = new SimulationAdminService({
      pool: buildPool(),
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    vi.spyOn(service, "listScopes").mockResolvedValue([
      {
        canonicalEventId,
        catalogScope: "live",
        canonicalCategory: "SPORTS",
        marketClass: HistoricalMarketClass.BINARY,
        routeMode: "POLYMARKET_LIMITLESS",
        coverageStart: new Date("2026-03-13T00:00:00.000Z"),
        coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
        routeableMarketCount: 1,
        venueCoverage: { polymarketRows: 4, limitlessRows: 4, opinionRows: 0, myriadRows: 0, predictRows: 0 }
      },
      {
        canonicalEventId: "22222222-2222-4222-8222-222222222222",
        catalogScope: "live",
        canonicalCategory: "CRYPTO",
        marketClass: HistoricalMarketClass.BINARY,
        routeMode: "POLYMARKET_LIMITLESS",
        coverageStart: new Date("2026-03-13T00:00:00.000Z"),
        coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
        routeableMarketCount: 1,
        venueCoverage: { polymarketRows: 4, limitlessRows: 4, opinionRows: 0, myriadRows: 0, predictRows: 0 }
      }
    ]);

    await expect(
      service.runSimulation({
        marketClass: HistoricalMarketClass.BINARY,
        routeMode: "POLYMARKET_LIMITLESS",
        side: "BUY",
        requestedNotional: "100",
        from: new Date("2026-03-13T00:00:00.000Z"),
        to: new Date("2026-03-13T01:00:00.000Z"),
        strategyKey: "strategy.sim.v1",
        dryRun: true
      })
    ).rejects.toBeInstanceOf(SimulationAdminConflictError);

    const missingService = new SimulationAdminService({
      pool: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("SELECT DISTINCT ON")) {
            return { rows: [] };
          }
          if (sql.includes("GROUP BY canonical_market_id, venue_market_id, venue")) {
            return { rows: [] };
          }
          if (sql.includes("FROM canonical_executable_market_members")) {
            return { rows: [] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        })
      } as unknown as Pool,
      historicalSimulationRunner: { run: vi.fn() } as never,
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection()) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection())
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    await expect(missingService.getCanonicalCoverage(canonicalEventId)).rejects.toBeInstanceOf(SimulationCanonicalCoverageNotFoundError);
  });

  it("builds scoped freshness and exposes unavailable route modes for legacy markets", async () => {
    const cryptoEventId = "22222222-2222-4222-8222-222222222222";
    const pool = buildPool({ includeLegacy: true, eventId: cryptoEventId });
    const run = vi.fn(async () => ({
      runId: null,
      dryRun: true,
      status: HistoricalSimulationRunStatus.SUCCEEDED,
      sliceResults: [],
      sliceCount: 0,
      persistedResultCount: 0,
      blockedSliceCount: 0,
      metadata: {}
    }));

    const service = new SimulationAdminService({
      pool,
      historicalSimulationRunner: { run },
      resolutionRiskAdminService: { getCanonicalInspection: vi.fn(async () => buildInspection({ eventId: cryptoEventId, includeLegacy: true })) } as never,
      historicalSimulationCatalogService: {
        hasCanonicalEvent: vi.fn(async () => false),
        getCanonicalInspection: vi.fn(async () => buildInspection({ eventId: cryptoEventId, includeLegacy: true }))
      } as never,
      configVersion: "cfg-hist-v1",
      engineVersion: "eng-hist-v1"
    });

    await service.runSimulation({
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS",
      canonicalEventId: cryptoEventId,
      canonicalMarketId: "MARKET-1",
      side: "BUY",
      requestedNotional: "100",
      from: new Date("2026-03-13T00:00:00.000Z"),
      to: new Date("2026-03-13T01:00:00.000Z"),
      strategyKey: "strategy.sim.v1",
      dryRun: true
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      canonicalMarketId: "MARKET-1",
      routeMode: "POLYMARKET_LIMITLESS",
      providedSnapshots: {
        resolutionRiskByTimestamp: {
          "2026-03-13T00:00:00.000Z": expect.objectContaining({
            canonicalMarketId: "MARKET-1",
            safeEquivalentEligible: true
          })
        }
      }
    }));

    const coverage = await service.getCanonicalCoverage(cryptoEventId, "MARKET-1");
    const legacyMarket = coverage.canonicalMarkets.find((market) => market.canonicalMarketId === "MARKET-LEGACY");
    expect(coverage.canonicalMarketId).toBe("MARKET-1");
    expect(coverage.resolutionRiskInspection.freshness).toEqual(expect.objectContaining({
      profileCount: 2,
      expectedPairCount: 1,
      persistedPairCount: 1
    }));
    expect(legacyMarket?.routeModes.find((route) => route.routeMode === "POLYMARKET_LIMITLESS")).toEqual(
      expect.objectContaining({
        runnable: false,
        reason: "missing_required_venue"
      })
    );
  });
});
