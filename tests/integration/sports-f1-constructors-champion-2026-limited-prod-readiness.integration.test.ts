import { describe, expect, it } from "vitest";

import { buildSportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-f1-constructors-champion-2026-limited-prod-readiness.js";

describe("sports f1 constructors champion 2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict tri lane review-gated", () => {
    const artifacts = buildSportsF1ConstructorsChampion2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
        admittedConstructors: [
          "aston_martin",
          "audi",
          "ferrari",
          "mclaren",
          "mercedes",
          "red_bull_racing",
          "williams"
        ]
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
        matcherLanes: [
          "aston_martin",
          "audi",
          "ferrari",
          "mclaren",
          "mercedes",
          "red_bull_racing",
          "williams"
        ].map((club) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      triLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            clubs: [
              "ferrari",
              "mclaren",
              "mercedes",
              "red_bull_racing"
            ]
          }
        ]
      },
      rejections: {
        rejections: [
          {
            scope: "constructor",
            normalizedConstructorName: "aston_martin",
            reason: "ALL_VENUE_EDGE_MISSING",
            notes: "Not in strict tri core."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW",
        bestPair: "LIMITLESS|POLYMARKET",
        bestAllVenueIfAny: null,
        pairMatcherReady: true,
        allVenueMatcherReady: false,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 7,
        exactSafeAllVenueCandidateCount: 0,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriConstructors).toEqual([
      "ferrari",
      "mclaren",
      "mercedes",
      "red_bull_racing"
    ]);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeConstructors).toHaveLength(7);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
