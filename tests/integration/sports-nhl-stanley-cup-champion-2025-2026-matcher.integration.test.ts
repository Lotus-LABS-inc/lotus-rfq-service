import { describe, expect, it } from "vitest";

import { buildSportsNhlStanleyCupChampion20252026MatcherMaterialization } from "../../src/matching/sports/sports-nhl-stanley-cup-champion-2025-2026-matcher.js";
import type {
  SportsNhlStanleyCupChampionComparabilityTopicSummary,
  SportsNhlStanleyCupChampionNormalizedTopicRow
} from "../../src/matching/sports/sports-nhl-stanley-cup-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsNhlStanleyCupChampionNormalizedTopicRow>
): SportsNhlStanleyCupChampionNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 NHL Stanley Cup Champion",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
  canonicalCompetition: "NHL_STANLEY_CUP",
  canonicalSeason: "2025_2026",
  canonicalTeamId: overrides.canonicalTeamId ?? "florida_panthers",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsNhlStanleyCupChampionComparabilityTopicSummary> = {}
): SportsNhlStanleyCupChampionComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 4,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 0,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 0,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Colorado Avalanche",
    "Dallas Stars",
    "Edmonton Oilers",
    "Tampa Bay Lightning"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [],
  notes: overrides.notes ?? []
});

describe("sports nhl stanley cup champion 2025-2026 matcher", () => {
  it("preserves the strict shared core and materializes the justified tri lane", () => {
    const normalizedTopics: SportsNhlStanleyCupChampionNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-col", venue: "LIMITLESS", venueMarketId: "ll-col", canonicalTeamId: "colorado_avalanche" }),
      buildRow({ interpretedContractId: "ll-dal", venue: "LIMITLESS", venueMarketId: "ll-dal", canonicalTeamId: "dallas_stars" }),
      buildRow({ interpretedContractId: "ll-edm", venue: "LIMITLESS", venueMarketId: "ll-edm", canonicalTeamId: "edmonton_oilers" }),
      buildRow({ interpretedContractId: "ll-tbl", venue: "LIMITLESS", venueMarketId: "ll-tbl", canonicalTeamId: "tampa_bay_lightning" }),
      buildRow({ interpretedContractId: "ll-fla", venue: "LIMITLESS", venueMarketId: "ll-fla", canonicalTeamId: "florida_panthers" }),
      buildRow({ interpretedContractId: "ll-lak", venue: "LIMITLESS", venueMarketId: "ll-lak", canonicalTeamId: "los_angeles_kings" }),
      buildRow({ interpretedContractId: "op-col", venue: "OPINION", venueMarketId: "op-col", canonicalTeamId: "colorado_avalanche" }),
      buildRow({ interpretedContractId: "op-dal", venue: "OPINION", venueMarketId: "op-dal", canonicalTeamId: "dallas_stars" }),
      buildRow({ interpretedContractId: "op-edm", venue: "OPINION", venueMarketId: "op-edm", canonicalTeamId: "edmonton_oilers" }),
      buildRow({ interpretedContractId: "op-tbl", venue: "OPINION", venueMarketId: "op-tbl", canonicalTeamId: "tampa_bay_lightning" }),
      buildRow({ interpretedContractId: "pm-col", venue: "POLYMARKET", venueMarketId: "pm-col", canonicalTeamId: "colorado_avalanche" }),
      buildRow({ interpretedContractId: "pm-dal", venue: "POLYMARKET", venueMarketId: "pm-dal", canonicalTeamId: "dallas_stars" }),
      buildRow({ interpretedContractId: "pm-edm", venue: "POLYMARKET", venueMarketId: "pm-edm", canonicalTeamId: "edmonton_oilers" }),
      buildRow({ interpretedContractId: "pm-tbl", venue: "POLYMARKET", venueMarketId: "pm-tbl", canonicalTeamId: "tampa_bay_lightning" }),
      buildRow({ interpretedContractId: "pm-fla", venue: "POLYMARKET", venueMarketId: "pm-fla", canonicalTeamId: "florida_panthers" }),
      buildRow({ interpretedContractId: "pm-lak", venue: "POLYMARKET", venueMarketId: "pm-lak", canonicalTeamId: "los_angeles_kings" })
    ];

    const materialized = buildSportsNhlStanleyCupChampion20252026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary({
        venuesPresent: ["LIMITLESS", "OPINION", "POLYMARKET"],
        pairSharedNamedOutcomesCount: 6,
        triSharedNamedOutcomesCount: 4,
        sharedNamedOutcomes: [
          "Colorado Avalanche",
          "Dallas Stars",
          "Edmonton Oilers",
          "Tampa Bay Lightning",
          "Florida Panthers",
          "Los Angeles Kings"
        ]
      })]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(6);
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(materialized.finalDecision.exactSafeTriCandidateCount).toBe(4);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(6);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
