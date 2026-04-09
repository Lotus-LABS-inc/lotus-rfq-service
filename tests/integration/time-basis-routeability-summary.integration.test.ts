import { describe, expect, it, vi } from "vitest";

import { buildTimeBasisRouteabilitySummary } from "../../src/operations/semantic-expansion/time-basis-routeability-summary.js";

describe("time-basis routeability summary", () => {
  it("splits routeability into historical, live, and mixed views", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM venue_market_profiles vmp")) {
          return {
            rows: [
              {
                venue_market_profile_id: "vmp-1",
                canonical_event_id: "event-1",
                canonical_market_id: "market-1",
                executable_member_count: 1,
                canonical_category: "CRYPTO",
                venue: "LIMITLESS",
                venue_market_id: "limitless-live-btc",
                title: "Will Bitcoin go up or down on March 22?",
                description: "BTC daily directional",
                rules: "BTC daily directional",
                market_type: "BINARY",
                market_class: "BINARY",
                outcomes: [],
                outcome_schema: {},
                topics: [],
                published_at: null,
                expires_at: null,
                resolves_at: null,
                fees: {},
                fee_model: null,
                resolution_source: null,
                resolution_title: null,
                resolution_rules_text: null,
                normalized_resolution_authority_type: null,
                rule_text: null,
                source_hierarchy: {},
                dispute_window_hours: null,
                ambiguous_time_boundary: false,
                ambiguous_source_reference: false,
                ambiguous_jurisdiction_or_scope: false,
                settlement_type: null,
                settlement_lag_hours: null,
                finality_lag_hours: null,
                payout_timing_hours: null,
                fee_on_entry: false,
                fee_on_exit: false,
                time_sensitive_fee_behavior: null,
                requires_conservative_anchor: false,
                network: null,
                chain: null,
                raw_source_payload: {},
                normalized_payload: {},
                mapping_lineage: [],
                confidence_score: null,
                source_metadata_version: "limitless-live-bootstrap-v1",
                historical_row_count: "1",
                latest_historical_timestamp: null
              },
              {
                venue_market_profile_id: "vmp-2",
                canonical_event_id: "event-1",
                canonical_market_id: "market-1",
                executable_member_count: 1,
                canonical_category: "CRYPTO",
                venue: "OPINION",
                venue_market_id: "opinion-historical-btc",
                title: "Bitcoin Up or Down on March 22? (12:00 ET)",
                description: "BTC daily directional",
                rules: "BTC daily directional",
                market_type: "BINARY",
                market_class: "BINARY",
                outcomes: [],
                outcome_schema: {},
                topics: [],
                published_at: null,
                expires_at: null,
                resolves_at: null,
                fees: {},
                fee_model: null,
                resolution_source: null,
                resolution_title: null,
                resolution_rules_text: null,
                normalized_resolution_authority_type: null,
                rule_text: null,
                source_hierarchy: {},
                dispute_window_hours: null,
                ambiguous_time_boundary: false,
                ambiguous_source_reference: false,
                ambiguous_jurisdiction_or_scope: false,
                settlement_type: null,
                settlement_lag_hours: null,
                finality_lag_hours: null,
                payout_timing_hours: null,
                fee_on_entry: false,
                fee_on_exit: false,
                time_sensitive_fee_behavior: null,
                requires_conservative_anchor: false,
                network: null,
                chain: null,
                raw_source_payload: {},
                normalized_payload: {},
                mapping_lineage: [],
                confidence_score: null,
                source_metadata_version: "opinion-current-bootstrap-v1",
                historical_row_count: "2",
                latest_historical_timestamp: null
              }
            ]
          };
        }
        if (sql.includes("FROM historical_market_states") && sql.includes("GROUP BY canonical_event_id")) {
          return {
            rows: [
              {
                canonical_event_id: "event-1",
                venue: "LIMITLESS",
                venue_market_id: "limitless-live-btc",
                metadata_version: "limitless-live-bootstrap-v1",
                row_count: "1"
              },
              {
                canonical_event_id: "event-1",
                venue: "OPINION",
                venue_market_id: "opinion-historical-btc",
                metadata_version: "predexon-v2",
                row_count: "2"
              }
            ]
          };
        }
        return { rows: [] };
      })
    } as never;

    const simulationAdminService = {
      getRouteabilitySummary: vi.fn(async () => ({
        filters: { category: "ALL", catalogScope: "ALL", marketClass: null },
        totals: { eventCount: 1, canonicalMarketCount: 1, runnableSingleCount: 0, runnablePairCount: 1, runnableTriCount: 0 },
        routeModes: [],
        blockReasons: [],
        venueVisibility: { polymarketEvents: 0, limitlessEvents: 1, opinionEvents: 1, myriadEvents: 0, predictEvents: 0 },
        opinionRouteability: {
          eventsWithOpinionInventory: 1,
          eventsWithRunnableOpinionOnly: 0,
          eventsWithBlockedOpinionPairOrTri: 1,
          semanticsRulepackVersion: null,
          exactLiveOnlyCount: 0,
          exactHistoricalQualifiedCount: 0,
          nearMissCount: 0,
          blockedUnsafeCandidateCount: 0,
          lowConfidenceCandidateCount: 0,
          dominantBlockReasons: [],
          dominantNearMissDimensions: [],
          dominantNearMissReasons: []
        },
        predictRouteability: {
          eventsWithPredictInventory: 0,
          eventsWithCurrentStateOnlyPredict: 0,
          eventsWithHistoricallyQualifiedPredict: 0,
          eventsWithBlockedPredictRoutes: 0,
          dominantBlockReasons: []
        },
        triRouteability: { candidateCount: 0, runnableCount: 0, dominantBlockReasons: [] }
      })),
      getCanonicalCoverage: vi.fn(async () => ({
        canonicalEventId: "event-1",
        catalogScope: "historical_simulation",
        canonicalMarketId: null,
        canonicalCategory: "CRYPTO",
        marketClass: "BINARY",
        venueCoverage: [],
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
        pairedMarkets: [],
        canonicalMarkets: [{
          canonicalMarketId: "market-1",
          isRunnable: false,
          venues: [
            { venue: "LIMITLESS", venueMarketId: "limitless-live-btc", title: "Limitless BTC" },
            { venue: "OPINION", venueMarketId: "opinion-historical-btc", title: "Opinion BTC" }
          ],
          routeModes: [
            {
              routeMode: "LIMITLESS_OPINION",
              label: "Limitless + Opinion",
              cardinality: "pair",
              requiredVenues: ["LIMITLESS", "OPINION"],
              runnable: false,
              reason: "missing_historical_rows"
            }
          ],
          runnableRouteModes: []
        }],
        routeModeSummary: [
          {
            routeMode: "LIMITLESS_OPINION",
            label: "Limitless + Opinion",
            cardinality: "pair",
            routeableMarketCount: 0,
            hasAnyRoute: false
          }
        ],
        hasTriVenueRoute: false,
        triVenueRouteableMarketCount: 0,
        resolutionRiskInspection: { profiles: [], assessments: [], freshness: {}, canonicalEventId: "event-1", scoringVersion: "v1" },
        ambiguity: {}
      }))
    } as never;

    const summary = await buildTimeBasisRouteabilitySummary({
      repoRoot: process.cwd(),
      pool,
      simulationAdminService
    });

    expect(summary.inventoryAudit.marketBasisDetails).toHaveLength(2);
    expect(summary.explicitAnswers.limitlessOpinionZeroDerivedFrom.MIXED_BASIS).toBe(1);
    expect(summary.routeabilityByBasis.find((slice) => slice.basis === "MIXED_BASIS")?.blockReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "missing_historical_rows" })])
    );
  });
});
