import { describe, expect, it } from "vitest";

import { HistoricalMarketClass } from "../../src/core/historical-simulation/historical-simulation.types.js";
import type { CategoryGroupedCanonicalReport } from "../../src/operations/fast-testing/simulation-canonical-report.js";
import { buildPmLimitlessRouteableAnchorSeedsFromCanonicalReport } from "../../src/operations/semantic-expansion/pm-limitless-anchor-seeds.js";

describe("buildPmLimitlessRouteableAnchorSeedsFromCanonicalReport", () => {
  it("returns only in-scope runnable PM+Limitless anchors and excludes politics", () => {
    const report: CategoryGroupedCanonicalReport = {
      observedAt: "2026-03-29T00:00:00.000Z",
      categories: {
        POLITICS: [
          {
            canonicalEventId: "event-politics",
            catalogScope: "historical_simulation",
            category: "POLITICS",
            marketClass: HistoricalMarketClass.BINARY,
            coverageStart: null,
            coverageEnd: null,
            venueCoverage: [],
            routeModeSummary: [],
            predictReadinessOverview: {
              state: "UNUSABLE",
              historicalQualified: false,
              reasons: [],
              recorderAccumulatingMarkets: 0,
              fallbackReadyMarkets: 0,
              nativeReadyMarkets: 0,
              currentStateOnlyMarkets: 0,
              unusableMarkets: 0
            },
            hasTriVenueRoute: false,
            triVenueRouteableMarketCount: 0,
            canonicalMarkets: [
              {
                canonicalMarketId: "market-politics",
                isRunnable: true,
                venues: [
                  { venue: "POLYMARKET", venueMarketId: "pm-politics", title: "Politics PM" },
                  { venue: "LIMITLESS", venueMarketId: "lm-politics", title: "Politics LM" }
                ],
                routeModes: [],
                runnableRouteModes: ["POLYMARKET_LIMITLESS"],
                opinionExactMatch: null,
                predictReadiness: null
              }
            ]
          }
        ],
        CRYPTO: [
          {
            canonicalEventId: "event-crypto",
            catalogScope: "historical_simulation",
            category: "CRYPTO",
            marketClass: HistoricalMarketClass.BINARY,
            coverageStart: null,
            coverageEnd: null,
            venueCoverage: [],
            routeModeSummary: [],
            predictReadinessOverview: {
              state: "UNUSABLE",
              historicalQualified: false,
              reasons: [],
              recorderAccumulatingMarkets: 0,
              fallbackReadyMarkets: 0,
              nativeReadyMarkets: 0,
              currentStateOnlyMarkets: 0,
              unusableMarkets: 0
            },
            hasTriVenueRoute: false,
            triVenueRouteableMarketCount: 0,
            canonicalMarkets: [
              {
                canonicalMarketId: "market-crypto",
                isRunnable: true,
                venues: [
                  { venue: "POLYMARKET", venueMarketId: "pm-crypto", title: "Bitcoin Up or Down on March 21?" },
                  { venue: "LIMITLESS", venueMarketId: "lm-crypto", title: "Bitcoin Up or Down on March 21?" }
                ],
                routeModes: [],
                runnableRouteModes: ["POLYMARKET_LIMITLESS"],
                opinionExactMatch: null,
                predictReadiness: null
              }
            ]
          }
        ],
        SPORTS: [],
        ESPORTS: []
      }
    };

    const details = new Map<string, {
      venue: "POLYMARKET" | "LIMITLESS";
      venueMarketId: string;
      title: string;
      rules: string;
      boundaryReferenceAt: string;
    }>([
      ["POLYMARKET:pm-crypto", {
        venue: "POLYMARKET",
        venueMarketId: "pm-crypto",
        title: "Bitcoin Up or Down on March 21?",
        rules: "Resolve using official market close on March 21, 2026.",
        boundaryReferenceAt: "2026-03-21T12:00:00.000Z"
      }],
      ["LIMITLESS:lm-crypto", {
        venue: "LIMITLESS",
        venueMarketId: "lm-crypto",
        title: "Bitcoin Up or Down on March 21?",
        rules: "Resolve using official market close on March 21, 2026.",
        boundaryReferenceAt: "2026-03-21T12:00:00.000Z"
      }]
    ]);

    const seeds = buildPmLimitlessRouteableAnchorSeedsFromCanonicalReport({
      report,
      profileDetailsByKey: details
    });

    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toEqual(expect.objectContaining({
      seedReference: "market-crypto",
      canonicalCategory: "CRYPTO",
      memberVenues: ["LIMITLESS", "POLYMARKET"],
      targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION"]
    }));
    expect(seeds[0]?.exactDateSearch?.exactDayBoundary).toBe("march 21 2026");
  });
});
