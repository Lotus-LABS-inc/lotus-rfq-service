import { describe, expect, it } from "vitest";

import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { buildAllPairRouteQualifications } from "../../src/qualification/pair-route-qualification.js";

describe("pair route qualification", () => {
  it("evaluates pair routes with basis-aware readiness", () => {
    const qualifications = buildAllPairRouteQualifications({
      PAIR_PM_LIMITLESS: QualificationStage.INTERNAL_ONLY,
      PAIR_PM_OPINION: QualificationStage.INTERNAL_ONLY
    }, {
      timeBasisSummary: {
        routeabilityByBasis: [
          { basis: "HISTORICAL_ONLY", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 0, eventCount: 0 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
          { basis: "LIVE_ONLY", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 0, eventCount: 0 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
          { basis: "MIXED_BASIS", routeModes: [{ routeMode: "POLYMARKET_LIMITLESS", routeableMarketCount: 0, eventCount: 0 }, { routeMode: "POLYMARKET_OPINION", routeableMarketCount: 1, eventCount: 1 }], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] },
          { basis: "INSUFFICIENT_BASIS", routeModes: [], totals: { eventCount: 0, canonicalMarketCount: 0, runnableSingleCount: 0, runnablePairCount: 0, runnableTriCount: 0 }, blockReasons: [] }
        ]
      },
      pairFamilyReport: {
        families: [
          { pairFamily: "POLYMARKET_LIMITLESS", exactHistoricalQualifiedCount: 1, exactLiveOnlyCount: 0, nearExactCount: 6, noCandidateCount: 0, dominantBlockerFamilies: [{ blocker: "timeBoundaryMatch", count: 3 }] },
          { pairFamily: "POLYMARKET_OPINION", exactHistoricalQualifiedCount: 0, exactLiveOnlyCount: 0, nearExactCount: 10, noCandidateCount: 1, dominantBlockerFamilies: [{ blocker: "conditionActionMatch", count: 4 }] }
        ]
      },
      crossVenueReport: {
        matches: [
          {
            category: "CRYPTO",
            venueSet: ["LIMITLESS", "POLYMARKET"],
            seed: { title: "Bitcoin all time high by March 31, 2026?", canonicalEventId: "event-1", canonicalMarketId: "market-1" },
            candidate: { title: "Bitcoin all time high by March 31?", canonicalEventId: "event-1", canonicalMarketId: "market-1" },
            exactPromotionEligible: true,
            historicalQualified: true
          }
        ]
      },
      simulationCanonicalEvents: {
        categories: {
          CRYPTO: [
            {
              canonicalEventId: "event-1",
              category: "CRYPTO",
              catalogScope: "historical",
              canonicalMarkets: [
                {
                  canonicalMarketId: "market-1",
                  venues: [
                    { venue: "POLYMARKET", venueMarketId: "pm-1", title: "PM" },
                    { venue: "LIMITLESS", venueMarketId: "lt-1", title: "LT" }
                  ],
                  runnableRouteModes: ["POLYMARKET_LIMITLESS"]
                },
                {
                  canonicalMarketId: "market-2",
                  venues: [
                    { venue: "POLYMARKET", venueMarketId: "pm-2", title: "PM" },
                    { venue: "OPINION", venueMarketId: "op-2", title: "OP" }
                  ],
                  runnableRouteModes: ["POLYMARKET_OPINION"]
                }
              ]
            }
          ]
        }
      }
    } as never);

    expect(qualifications).toHaveLength(2);
    expect(qualifications.find((entry) => entry.routeClassId === "PAIR_PM_LIMITLESS")?.readinessState).toBe("SHADOW_READY");
    expect(qualifications.find((entry) => entry.routeClassId === "PAIR_PM_OPINION")?.readinessState).toBe("SHADOW_READY");
  });
});

