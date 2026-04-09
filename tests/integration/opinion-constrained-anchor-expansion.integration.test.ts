import { describe, expect, it } from "vitest";

import type { CrossVenueMatchReport } from "../../src/operations/semantic-expansion/shared.js";
import { buildOpinionConstrainedAnchorSeedsFromInputs } from "../../src/operations/semantic-expansion/pm-limitless-opinion-constrained-anchor-expansion.js";

describe("buildOpinionConstrainedAnchorSeedsFromInputs integration shape", () => {
  it("does not add anchors for families absent from Opinion inventory", () => {
    const report = {
      observedAt: new Date().toISOString(),
      afterRulepackRefresh: false,
      semanticsRulepackVersion: "test",
      inventorySummary: {
        totalMarkets: 2,
        categories: {},
        venues: { POLYMARKET: 1, LIMITLESS: 1, OPINION: 0, MYRIAD: 0, PREDICT: 0 },
        evidenceLabels: { historical: 2, current_state: 0, recorder: 0, fallback: 0, live_inventory_only: 0 }
      },
      matches: [],
      promotionCandidates: [],
      summary: {
        exactHistoricalQualified: 0,
        exactLiveOnly: 0,
        nearExact: 0,
        proxyOrMismatch: 0,
        blockedByCompatibility: 0
      },
      metrics: {} as CrossVenueMatchReport["metrics"]
    } satisfies CrossVenueMatchReport;

    const result = buildOpinionConstrainedAnchorSeedsFromInputs({
      baselineSeeds: [],
      report,
      inventoryByKey: new Map(),
      opinionFamilySummary: {
        observedAt: new Date().toISOString(),
        metadataVersion: "test",
        scannedMarketCount: 0,
        countsByCategory: { CRYPTO: 0, SPORTS: 0, ESPORTS: 0, OTHER: 0 },
        countsByFamily: {
          ATH_BY_DATE: 0,
          THRESHOLD_BY_DATE: 0,
          SAME_DAY_DIRECTIONAL: 0,
          PRICE_AT_CLOSE: 0,
          GENERIC_UP_DOWN: 0,
          MATCHUP_WINNER: 0,
          CHAMPIONSHIP_WINNER: 0,
          SEASON_WINNER: 0,
          TOURNAMENT_WINNER: 0,
          SPLIT_WINNER: 0,
          LEAGUE_WINNER: 0,
          OTHER: 0
        },
        families: []
      },
      opinionFamilyClassifications: []
    });

    expect(result.summary.addedSeedCount).toBe(0);
    expect(result.seeds).toHaveLength(0);
  });
});
