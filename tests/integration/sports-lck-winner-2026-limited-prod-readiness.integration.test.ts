import { describe, expect, it } from "vitest";

import { buildSportsLckWinner2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-lck-winner-2026-limited-prod-readiness.js";

describe("sports lck winner 2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict tri lane review-gated", () => {
    const artifacts = buildSportsLckWinner2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|LEAGUE_WINNER|LCK|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
        admittedTeams: [
          "dplus",
          "freecs",
          "gen_g_esports",
          "hanwha_life_esports",
          "kt_rolster",
          "t1"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|LCK|2026",
        matcherLanes: [
          "dplus",
          "gen_g_esports",
          "hanwha_life_esports",
          "kt_rolster",
          "t1"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|LEAGUE_WINNER|LCK|2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      triLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|LCK|2026",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            clubs: [
              "dplus",
              "gen_g_esports",
              "t1"
            ]
          }
        ]
      },
      rejections: {
        rejections: [
          {
            scope: "team",
            normalizedTeamName: "Nongshim RedForce",
            reason: "NOT_SHARED",
            notes: "Not in strict shared core."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_LCK_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 5,
        exactSafeTriCandidateCount: 3,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriTeams).toEqual([
      "dplus",
      "gen_g_esports",
      "t1"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeTeams).toHaveLength(5);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
