import { describe, expect, it } from "vitest";

import { buildSportsChampionsLeagueWinner20252026MatcherMaterialization } from "../../src/matching/sports/sports-champions-league-winner-2025-2026-matcher.js";
import type {
  SportsChampionsLeagueWinnerComparabilityTopicSummary,
  SportsChampionsLeagueWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-champions-league-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsChampionsLeagueWinnerNormalizedTopicRow>
): SportsChampionsLeagueWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "UEFA Champions League Winner",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
  canonicalCompetition: "UEFA_CHAMPIONS_LEAGUE",
  canonicalSeason: "2025_2026",
  canonicalClubId: overrides.canonicalClubId ?? "real_madrid",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsChampionsLeagueWinnerComparabilityTopicSummary> = {}
): SportsChampionsLeagueWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 12,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 10,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 4,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Arsenal",
    "Atletico Madrid",
    "Barcelona",
    "Bayern Munich",
    "Borussia Dortmund",
    "Chelsea",
    "Inter Milan",
    "Juventus",
    "Liverpool",
    "Manchester City",
    "Paris Saint-Germain",
    "Real Madrid"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Aston Villa", reason: "NOT_SHARED", venues: ["LIMITLESS"] },
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["PREDICT"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports champions league winner 2025-2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict all-venue core to 4 clubs", () => {
    const normalizedTopics: SportsChampionsLeagueWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-real", venue: "LIMITLESS", venueMarketId: "ll-real", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "ll-psg", venue: "LIMITLESS", venueMarketId: "ll-psg", canonicalClubId: "paris_saint_germain" }),
      buildRow({ interpretedContractId: "ll-bayern", venue: "LIMITLESS", venueMarketId: "ll-bayern", canonicalClubId: "bayern_munich" }),
      buildRow({ interpretedContractId: "ll-arsenal", venue: "LIMITLESS", venueMarketId: "ll-arsenal", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "ll-barca", venue: "LIMITLESS", venueMarketId: "ll-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "op-real", venue: "OPINION", venueMarketId: "op-real", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "op-psg", venue: "OPINION", venueMarketId: "op-psg", canonicalClubId: "paris_saint_germain" }),
      buildRow({ interpretedContractId: "op-bayern", venue: "OPINION", venueMarketId: "op-bayern", canonicalClubId: "bayern_munich" }),
      buildRow({ interpretedContractId: "op-arsenal", venue: "OPINION", venueMarketId: "op-arsenal", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "pm-real", venue: "POLYMARKET", venueMarketId: "pm-real", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "pm-psg", venue: "POLYMARKET", venueMarketId: "pm-psg", canonicalClubId: "paris_saint_germain" }),
      buildRow({ interpretedContractId: "pm-bayern", venue: "POLYMARKET", venueMarketId: "pm-bayern", canonicalClubId: "bayern_munich" }),
      buildRow({ interpretedContractId: "pm-arsenal", venue: "POLYMARKET", venueMarketId: "pm-arsenal", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "pm-barca", venue: "POLYMARKET", venueMarketId: "pm-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "pr-real", venue: "PREDICT", venueMarketId: "pr-real", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "pr-psg", venue: "PREDICT", venueMarketId: "pr-psg", canonicalClubId: "paris_saint_germain" }),
      buildRow({ interpretedContractId: "pr-bayern", venue: "PREDICT", venueMarketId: "pr-bayern", canonicalClubId: "bayern_munich" }),
      buildRow({ interpretedContractId: "pr-arsenal", venue: "PREDICT", venueMarketId: "pr-arsenal", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "pr-barca", venue: "PREDICT", venueMarketId: "pr-barca", canonicalClubId: "barcelona" })
    ];

    const materialized = buildSportsChampionsLeagueWinner20252026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(5);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(4);
    expect(materialized.allVenueLanes.map((lane) => lane.normalizedClubName)).toEqual([
      "arsenal",
      "bayern_munich",
      "paris_saint_germain",
      "real_madrid"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(5);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "Aston Villa")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "barcelona" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
