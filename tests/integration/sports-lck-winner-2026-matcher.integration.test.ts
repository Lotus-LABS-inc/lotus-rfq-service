import { describe, expect, it } from "vitest";

import { buildSportsLckWinner2026MatcherMaterialization } from "../../src/matching/sports/sports-lck-winner-2026-matcher.js";
import type {
  SportsLckWinnerComparabilityTopicSummary,
  SportsLckWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-lck-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsLckWinnerNormalizedTopicRow>
): SportsLckWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "LoL: LCK 2026 Season Winner",
  canonicalFamily: "LEAGUE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LCK|2026",
  canonicalCompetition: "LCK",
  canonicalSeason: "2026",
  canonicalTeamId: overrides.canonicalTeamId ?? "gen_g_esports",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsLckWinnerComparabilityTopicSummary> = {}
): SportsLckWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LCK|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 6,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 3,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 0,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Dplus",
    "Freecs",
    "Gen.G Esports",
    "Hanwha Life Esports",
    "KT Rolster",
    "T1"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [],
  notes: overrides.notes ?? []
});

describe("sports lck winner 2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict tri core to the shared 3-venue teams", () => {
    const normalizedTopics: SportsLckWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-geng", venue: "LIMITLESS", venueMarketId: "ll-geng", canonicalTeamId: "gen_g_esports" }),
      buildRow({ interpretedContractId: "ll-hle", venue: "LIMITLESS", venueMarketId: "ll-hle", canonicalTeamId: "hanwha_life_esports" }),
      buildRow({ interpretedContractId: "ll-dplus", venue: "LIMITLESS", venueMarketId: "ll-dplus", canonicalTeamId: "dplus" }),
      buildRow({ interpretedContractId: "ll-t1", venue: "LIMITLESS", venueMarketId: "ll-t1", canonicalTeamId: "t1" }),
      buildRow({ interpretedContractId: "ll-kt", venue: "LIMITLESS", venueMarketId: "ll-kt", canonicalTeamId: "kt_rolster" }),
      buildRow({ interpretedContractId: "op-geng", venue: "OPINION", venueMarketId: "op-geng", canonicalTeamId: "gen_g_esports" }),
      buildRow({ interpretedContractId: "op-freecs", venue: "OPINION", venueMarketId: "op-freecs", canonicalTeamId: "freecs" }),
      buildRow({ interpretedContractId: "op-dplus", venue: "OPINION", venueMarketId: "op-dplus", canonicalTeamId: "dplus" }),
      buildRow({ interpretedContractId: "op-t1", venue: "OPINION", venueMarketId: "op-t1", canonicalTeamId: "t1" }),
      buildRow({ interpretedContractId: "pm-geng", venue: "POLYMARKET", venueMarketId: "pm-geng", canonicalTeamId: "gen_g_esports" }),
      buildRow({ interpretedContractId: "pm-hle", venue: "POLYMARKET", venueMarketId: "pm-hle", canonicalTeamId: "hanwha_life_esports" }),
      buildRow({ interpretedContractId: "pm-dplus", venue: "POLYMARKET", venueMarketId: "pm-dplus", canonicalTeamId: "dplus" }),
      buildRow({ interpretedContractId: "pm-t1", venue: "POLYMARKET", venueMarketId: "pm-t1", canonicalTeamId: "t1" }),
      buildRow({ interpretedContractId: "pm-freecs", venue: "POLYMARKET", venueMarketId: "pm-freecs", canonicalTeamId: "freecs" }),
      buildRow({ interpretedContractId: "pm-kt", venue: "POLYMARKET", venueMarketId: "pm-kt", canonicalTeamId: "kt_rolster" })
    ];

    const materialized = buildSportsLckWinner2026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(5);
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(materialized.finalDecision.exactSafeTriCandidateCount).toBe(3);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(5);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_LCK_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
