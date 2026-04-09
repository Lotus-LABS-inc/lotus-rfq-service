import { describe, expect, it } from "vitest";

import { buildSportsF1DriversChampion2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-f1-drivers-champion-2026-limited-prod-readiness.js";

describe("sports f1 drivers champion 2026 limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and the strict all-venue lane review-gated", () => {
    const pairDrivers = [
      "charles_leclerc",
      "fernando_alonso",
      "george_russell",
      "kimi_antonelli",
      "lando_norris",
      "lewis_hamilton",
      "max_verstappen",
      "oscar_piastri"
    ];
    const allVenueDrivers = [
      "george_russell",
      "lando_norris",
      "max_verstappen",
      "oscar_piastri"
    ];

    const artifacts = buildSportsF1DriversChampion2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedDrivers: pairDrivers
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
        matcherLanes: pairDrivers.map((driver) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          club: driver,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      allVenueLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: allVenueDrivers.map((driver) => ({
          venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
          club: driver,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026",
          routeabilityDecision: "ALL_VENUE_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "driver",
            normalizedDriverName: "Lewis Lawson",
            reason: "NOT_SHARED",
            notes: "Venue-only tail."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_F1_DRIVERS_CHAMPION_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestAllVenueIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        allVenueMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 8,
        exactSafeAllVenueCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeAllVenueDrivers).toEqual(allVenueDrivers);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeDrivers).toHaveLength(8);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
