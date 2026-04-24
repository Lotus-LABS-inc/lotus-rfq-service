import { describe, expect, it } from "vitest";

import { buildSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-nhl-stanley-cup-champion-2025-2026-limited-prod-readiness.js";

describe("sports nhl stanley cup champion 2025-2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict tri lane review-gated", () => {
    const artifacts = buildSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
        admittedTeams: [
          "anaheim_ducks",
          "carolina_hurricanes",
          "colorado_avalanche",
          "dallas_stars",
          "edmonton_oilers",
          "florida_panthers",
          "los_angeles_kings",
          "minnesota_wild",
          "montreal_canadiens",
          "new_jersey_devils",
          "new_york_rangers",
          "tampa_bay_lightning",
          "toronto_maple_leafs",
          "vegas_golden_knights",
          "washington_capitals",
          "winnipeg_jets"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
        matcherLanes: [
          "anaheim_ducks",
          "carolina_hurricanes",
          "colorado_avalanche",
          "dallas_stars",
          "edmonton_oilers",
          "florida_panthers",
          "los_angeles_kings",
          "minnesota_wild",
          "montreal_canadiens",
          "new_jersey_devils",
          "new_york_rangers",
          "tampa_bay_lightning"
          ,
          "toronto_maple_leafs",
          "vegas_golden_knights",
          "washington_capitals",
          "winnipeg_jets"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      triLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            clubs: [
              "colorado_avalanche",
              "dallas_stars",
              "edmonton_oilers",
              "tampa_bay_lightning"
            ]
          }
        ]
      },
      rejections: {
        rejections: [
          {
            scope: "team",
            normalizedTeamName: "Boston Bruins",
            reason: "NOT_SHARED",
            notes: "Not in the strict shared core."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 16,
        exactSafeTriCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriTeams).toEqual([
      "colorado_avalanche",
      "dallas_stars",
      "edmonton_oilers",
      "tampa_bay_lightning"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeTeams).toHaveLength(16);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
