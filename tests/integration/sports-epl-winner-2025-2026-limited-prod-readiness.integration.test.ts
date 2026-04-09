import { describe, expect, it } from "vitest";

import { buildSportsEplWinner20252026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-epl-winner-2025-2026-limited-prod-readiness.js";

describe("sports epl winner 2025-2026 limited-prod readiness", () => {
  it("keeps the pair route explicit and the all-venue lane review-gated", () => {
    const artifacts = buildSportsEplWinner20252026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedClubs: ["arsenal", "aston_villa", "chelsea", "liverpool", "manchester_city", "manchester_united"]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        matcherLanes: [
          "arsenal",
          "aston_villa",
          "chelsea",
          "liverpool",
          "manchester_city",
          "manchester_united"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      allVenueLanes: {
        canonicalTopicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          "arsenal",
          "liverpool",
          "manchester_city"
        ].map((club) => ({
          venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
          club,
          canonicalTopic: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
          routeabilityDecision: "ALL_VENUE_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "club",
            normalizedClubName: "Brentford",
            reason: "NOT_SHARED",
            notes: "Venue-only tail."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestAllVenueIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        allVenueMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 6,
        exactSafeAllVenueCandidateCount: 3,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW");
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeAllVenueClubs).toEqual(["arsenal", "liverpool", "manchester_city"]);
    expect(artifacts.pairReadiness.exactSafeClubs).toHaveLength(6);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
