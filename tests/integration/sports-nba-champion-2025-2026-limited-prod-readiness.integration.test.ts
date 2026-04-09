import { describe, expect, it } from "vitest";

import { buildSportsNbaChampion20252026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/sports-nba-champion-2025-2026-limited-prod-readiness.js";

describe("sports nba champion 2025-2026 limited-prod readiness", () => {
  it("keeps POLYMARKET|PREDICT explicit and the strict all-venue lane review-gated", () => {
    const pairTeams = [
      "atlanta_hawks",
      "boston_celtics",
      "brooklyn_nets",
      "charlotte_hornets",
      "chicago_bulls",
      "cleveland_cavaliers",
      "dallas_mavericks",
      "denver_nuggets",
      "detroit_pistons",
      "golden_state_warriors",
      "houston_rockets",
      "indiana_pacers",
      "los_angeles_clippers",
      "los_angeles_lakers",
      "memphis_grizzlies",
      "miami_heat",
      "milwaukee_bucks",
      "minnesota_timberwolves",
      "new_orleans_pelicans",
      "new_york_knicks",
      "oklahoma_city_thunder",
      "orlando_magic",
      "philadelphia_76ers",
      "phoenix_suns",
      "portland_trail_blazers",
      "sacramento_kings",
      "san_antonio_spurs",
      "toronto_raptors",
      "utah_jazz",
      "washington_wizards"
    ];
    const allVenueTeams = [
      "boston_celtics",
      "detroit_pistons",
      "oklahoma_city_thunder",
      "san_antonio_spurs"
    ];

    const artifacts = buildSportsNbaChampion20252026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedTeams: pairTeams
      },
      pairLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
        matcherLanes: pairTeams.map((team) => ({
          venuePair: "POLYMARKET|PREDICT",
          club: team,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      allVenueLanes: {
        canonicalTopicKey: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
        canonicalVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: allVenueTeams.map((team) => ({
          venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
          club: team,
          canonicalTopic: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
          routeabilityDecision: "ALL_VENUE_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "team",
            normalizedTeamName: "Seattle Supersonics",
            reason: "NOT_SHARED",
            notes: "Venue-only tail."
          }
        ]
      },
      finalDecision: {
        overallDecision: "SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST",
        bestPair: "POLYMARKET|PREDICT",
        bestAllVenueIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        allVenueMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 30,
        exactSafeAllVenueCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("POLYMARKET|PREDICT");
    expect(artifacts.readiness.exactSafeAllVenueTeams).toEqual(allVenueTeams);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.exactSafeTeams).toHaveLength(30);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
