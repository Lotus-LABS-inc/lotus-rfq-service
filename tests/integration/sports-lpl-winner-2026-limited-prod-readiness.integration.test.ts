import { describe, expect, it } from "vitest";

import { buildSportsLplWinner2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-lpl-winner-2026-limited-prod-readiness.js";

describe("sports lpl winner 2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict tri lane review-gated", () => {
    const artifacts = buildSportsLplWinner2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|LEAGUE_WINNER|LPL|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
        admittedTeams: [
          "anyones_legend",
          "bilibili_gaming",
          "jd_gaming",
          "top_esports",
          "weibo_gaming"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|LPL|2026",
        matcherLanes: [
          "anyones_legend",
          "bilibili_gaming",
          "jd_gaming",
          "top_esports",
          "weibo_gaming"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|LEAGUE_WINNER|LPL|2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      triLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|LPL|2026",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            clubs: [
              "anyones_legend",
              "bilibili_gaming",
              "jd_gaming",
              "top_esports"
            ]
          }
        ]
      },
      rejections: {
        rejections: [
          {
            scope: "team",
            normalizedTeamName: "Invictus Gaming",
            reason: "NOT_SHARED",
            notes: "Not in strict shared core."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_LPL_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 5,
        exactSafeTriCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_LPL_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriTeams).toEqual([
      "anyones_legend",
      "bilibili_gaming",
      "jd_gaming",
      "top_esports"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_LPL_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
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
