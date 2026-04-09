import { describe, expect, it } from "vitest";

import { buildSportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-champions-league-winner-2025-2026-limited-prod-readiness.js";

describe("sports champions league winner 2025-2026 limited-prod readiness", () => {
  it("keeps the pair route explicit and the all-venue lane review-gated", () => {
    const artifacts = buildSportsChampionsLeagueWinner20252026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedClubs: [
          "arsenal",
          "aston_villa",
          "atletico_madrid",
          "barcelona",
          "bayern_munich",
          "borussia_dortmund",
          "chelsea",
          "inter_milan",
          "liverpool",
          "paris_saint_germain",
          "real_madrid"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        matcherLanes: [
          "arsenal",
          "aston_villa",
          "atletico_madrid",
          "barcelona",
          "bayern_munich",
          "borussia_dortmund",
          "chelsea",
          "inter_milan",
          "liverpool",
          "paris_saint_germain",
          "real_madrid"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      allVenueLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          "arsenal",
          "bayern_munich",
          "paris_saint_germain",
          "real_madrid"
        ].map((club) => ({
          venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
          club,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
          routeabilityDecision: "ALL_VENUE_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "club",
            normalizedClubName: "Juventus",
            reason: "NOT_SHARED",
            notes: "Venue-only tail."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestAllVenueIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        allVenueMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 11,
        exactSafeAllVenueCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeAllVenueClubs).toEqual([
      "arsenal",
      "bayern_munich",
      "paris_saint_germain",
      "real_madrid"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeClubs).toHaveLength(11);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
