import { describe, expect, it } from "vitest";

import { buildSportsWorldCupWinner2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-world-cup-winner-2026-limited-prod-readiness.js";

describe("sports world cup winner 2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict all-venue lane review-gated", () => {
    const artifacts = buildSportsWorldCupWinner2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedTeams: [
          "argentina",
          "belgium",
          "brazil",
          "croatia",
          "england",
          "france",
          "germany",
          "italy",
          "mexico",
          "netherlands",
          "portugal",
          "spain",
          "united_states",
          "uruguay"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
        matcherLanes: [
          "argentina",
          "belgium",
          "brazil",
          "croatia",
          "england",
          "france",
          "germany",
          "italy",
          "mexico",
          "netherlands",
          "portugal",
          "spain",
          "united_states",
          "uruguay"
        ].map((team) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club: team,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      allVenueLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          "brazil",
          "england",
          "france",
          "spain"
        ].map((team) => ({
          venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
          club: team,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
          routeabilityDecision: "ALL_VENUE_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "team",
            normalizedTeamName: "Japan",
            reason: "NOT_SHARED",
            notes: "Venue-only tail."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestAllVenueIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        allVenueMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 14,
        exactSafeAllVenueCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeAllVenueTeams).toEqual([
      "brazil",
      "england",
      "france",
      "spain"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeTeams).toHaveLength(14);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
