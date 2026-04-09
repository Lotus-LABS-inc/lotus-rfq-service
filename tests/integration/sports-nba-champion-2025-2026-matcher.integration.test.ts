import { describe, expect, it } from "vitest";

import { buildSportsNbaChampion20252026MatcherMaterialization } from "../../src/matching/sports/sports-nba-champion-2025-2026-matcher.js";
import type {
  SportsNbaChampionComparabilityTopicSummary,
  SportsNbaChampionNormalizedTopicRow
} from "../../src/matching/sports/sports-nba-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsNbaChampionNormalizedTopicRow>
): SportsNbaChampionNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 NBA Champion",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
  canonicalCompetition: "NBA",
  canonicalSeason: "2025_2026",
  canonicalTeamId: overrides.canonicalTeamId ?? "oklahoma_city_thunder",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsNbaChampionComparabilityTopicSummary> = {}
): SportsNbaChampionComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 5,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 4,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 4,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 1,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Boston Celtics",
    "Denver Nuggets",
    "Detroit Pistons",
    "Oklahoma City Thunder",
    "San Antonio Spurs"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports nba champion 2025-2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict all-venue core to the shared 4-team set", () => {
    const normalizedTopics: SportsNbaChampionNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-okc", venue: "LIMITLESS", venueMarketId: "ll-okc", canonicalTeamId: "oklahoma_city_thunder" }),
      buildRow({ interpretedContractId: "ll-det", venue: "LIMITLESS", venueMarketId: "ll-det", canonicalTeamId: "detroit_pistons" }),
      buildRow({ interpretedContractId: "ll-sas", venue: "LIMITLESS", venueMarketId: "ll-sas", canonicalTeamId: "san_antonio_spurs" }),
      buildRow({ interpretedContractId: "ll-bos", venue: "LIMITLESS", venueMarketId: "ll-bos", canonicalTeamId: "boston_celtics" }),
      buildRow({ interpretedContractId: "ll-den", venue: "LIMITLESS", venueMarketId: "ll-den", canonicalTeamId: "denver_nuggets" }),
      buildRow({ interpretedContractId: "op-okc", venue: "OPINION", venueMarketId: "op-okc", canonicalTeamId: "oklahoma_city_thunder" }),
      buildRow({ interpretedContractId: "op-det", venue: "OPINION", venueMarketId: "op-det", canonicalTeamId: "detroit_pistons" }),
      buildRow({ interpretedContractId: "op-sas", venue: "OPINION", venueMarketId: "op-sas", canonicalTeamId: "san_antonio_spurs" }),
      buildRow({ interpretedContractId: "op-bos", venue: "OPINION", venueMarketId: "op-bos", canonicalTeamId: "boston_celtics" }),
      buildRow({ interpretedContractId: "pm-okc", venue: "POLYMARKET", venueMarketId: "pm-okc", canonicalTeamId: "oklahoma_city_thunder" }),
      buildRow({ interpretedContractId: "pm-det", venue: "POLYMARKET", venueMarketId: "pm-det", canonicalTeamId: "detroit_pistons" }),
      buildRow({ interpretedContractId: "pm-sas", venue: "POLYMARKET", venueMarketId: "pm-sas", canonicalTeamId: "san_antonio_spurs" }),
      buildRow({ interpretedContractId: "pm-bos", venue: "POLYMARKET", venueMarketId: "pm-bos", canonicalTeamId: "boston_celtics" }),
      buildRow({ interpretedContractId: "pm-den", venue: "POLYMARKET", venueMarketId: "pm-den", canonicalTeamId: "denver_nuggets" }),
      buildRow({ interpretedContractId: "pr-okc", venue: "PREDICT", venueMarketId: "pr-okc", canonicalTeamId: "oklahoma_city_thunder" }),
      buildRow({ interpretedContractId: "pr-det", venue: "PREDICT", venueMarketId: "pr-det", canonicalTeamId: "detroit_pistons" }),
      buildRow({ interpretedContractId: "pr-sas", venue: "PREDICT", venueMarketId: "pr-sas", canonicalTeamId: "san_antonio_spurs" }),
      buildRow({ interpretedContractId: "pr-bos", venue: "PREDICT", venueMarketId: "pr-bos", canonicalTeamId: "boston_celtics" })
    ];

    const materialized = buildSportsNbaChampion20252026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(5);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(4);
    expect(materialized.strictAllLanes.map((lane) => lane.normalizedTeamName)).toEqual([
      "boston_celtics",
      "detroit_pistons",
      "oklahoma_city_thunder",
      "san_antonio_spurs"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(5);
    expect(materialized.rejections.some((rejection) => rejection.normalizedTeamName === "denver_nuggets" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
