import { describe, expect, it, vi } from "vitest";

import type { SimulationCanonicalCoverage } from "../../src/api/admin/simulation-admin-service.js";
import { buildCategoryGroupedCanonicalReport } from "../../src/operations/fast-testing/simulation-canonical-report.js";
import { HistoricalMarketClass } from "../../src/core/historical-simulation/historical-simulation.types.js";

describe("simulation canonical report", () => {
  it("groups canonical coverage by simulation category and preserves routeability details", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            canonical_event_id: "event-politics",
            canonical_category: "POLITICS"
          },
          {
            canonical_event_id: "event-sports",
            canonical_category: "SPORTS"
          }
        ]
      }))
    };
    const simulationAdminService = {
      getCanonicalCoverage: vi.fn(async (eventId: string): Promise<SimulationCanonicalCoverage> => ({
        canonicalEventId: eventId,
        catalogScope: "historical_simulation",
        canonicalMarketId: null,
        canonicalCategory: eventId === "event-politics" ? "POLITICS" : "SPORTS",
        marketClass: HistoricalMarketClass.BINARY,
        venueCoverage: [
          {
            venue: "POLYMARKET",
            rowCount: 10,
            coverageStart: new Date("2026-03-01T00:00:00.000Z"),
            coverageEnd: new Date("2026-03-20T00:00:00.000Z")
          }
        ],
        routeModeSummary: [
          {
            routeMode: "POLYMARKET_LIMITLESS",
            label: "Predexon + Limitless",
            cardinality: "pair",
            routeableMarketCount: 1,
            hasAnyRoute: true
          },
          {
            routeMode: "POLYMARKET_LIMITLESS_OPINION",
            label: "Predexon + Limitless + Opinion",
            cardinality: "tri",
            routeableMarketCount: 0,
            hasAnyRoute: false
          }
        ],
        predictReadinessOverview: {
          state: "UNUSABLE",
          historicalQualified: false,
          reasons: ["no_predict_evidence_available"],
          recorderAccumulatingMarkets: 0,
          fallbackReadyMarkets: 0,
          nativeReadyMarkets: 0,
          currentStateOnlyMarkets: 0,
          unusableMarkets: 1
        },
        hasTriVenueRoute: false,
        triVenueRouteableMarketCount: 0,
        pairedMarkets: [],
        canonicalMarkets: [
          {
            canonicalMarketId: `${eventId}-market-1`,
            isRunnable: true,
            runnableRouteModes: ["POLYMARKET_LIMITLESS"],
            venues: [],
            routeModes: [
              {
                routeMode: "POLYMARKET_LIMITLESS",
                label: "Predexon + Limitless",
                cardinality: "pair",
                requiredVenues: ["POLYMARKET", "LIMITLESS"],
                runnable: true,
                reason: null
              },
              {
                routeMode: "POLYMARKET_LIMITLESS_OPINION",
                label: "Predexon + Limitless + Opinion",
                cardinality: "tri",
                requiredVenues: ["POLYMARKET", "LIMITLESS", "OPINION"],
                runnable: false,
                reason: "missing_required_venue"
              }
            ]
          }
        ],
        resolutionRiskInspection: {
          canonicalEventId: eventId,
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 0,
            expectedPairCount: 0,
            persistedPairCount: 0,
            lastComputedAt: null,
            latestProfileUpdatedAt: null,
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        },
        ambiguity: {}
      }))
    };

    const report = await buildCategoryGroupedCanonicalReport({
      pool: pool as never,
      simulationAdminService
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(simulationAdminService.getCanonicalCoverage).toHaveBeenCalledTimes(2);
    expect(report.categories.POLITICS).toHaveLength(1);
    expect(report.categories.SPORTS).toHaveLength(1);
    expect(report.categories.CRYPTO).toHaveLength(0);
    expect(report.categories.ESPORTS).toHaveLength(0);
    expect(report.categories.POLITICS[0]?.routeModeSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeMode: "POLYMARKET_LIMITLESS" }),
        expect.objectContaining({ routeMode: "POLYMARKET_LIMITLESS_OPINION", cardinality: "tri" })
      ])
    );
  });
});
