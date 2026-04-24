import { describe, expect, it } from "vitest";

import { buildSportsLplWinner2026MatcherMaterialization } from "../../src/matching/sports/sports-lpl-winner-2026-matcher.js";
import type {
  SportsLplWinnerComparabilityTopicSummary,
  SportsLplWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-lpl-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsLplWinnerNormalizedTopicRow>
): SportsLplWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "LoL: LPL 2026 Season Winner",
  canonicalFamily: "LEAGUE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LPL|2026",
  canonicalCompetition: "LPL",
  canonicalSeason: "2026",
  canonicalTeamId: overrides.canonicalTeamId ?? "bilibili_gaming",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsLplWinnerComparabilityTopicSummary> = {}
): SportsLplWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LPL|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 5,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 4,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 0,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Anyone's Legend",
    "Bilibili Gaming",
    "JD Gaming",
    "Top Esports",
    "Weibo Gaming"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [],
  notes: overrides.notes ?? []
});

describe("sports lpl winner 2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict tri core to the shared 3-venue teams", () => {
    const normalizedTopics: SportsLplWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-blg", venue: "LIMITLESS", venueMarketId: "ll-blg", canonicalTeamId: "bilibili_gaming" }),
      buildRow({ interpretedContractId: "ll-al", venue: "LIMITLESS", venueMarketId: "ll-al", canonicalTeamId: "anyones_legend" }),
      buildRow({ interpretedContractId: "ll-jdg", venue: "LIMITLESS", venueMarketId: "ll-jdg", canonicalTeamId: "jd_gaming" }),
      buildRow({ interpretedContractId: "ll-tes", venue: "LIMITLESS", venueMarketId: "ll-tes", canonicalTeamId: "top_esports" }),
      buildRow({ interpretedContractId: "ll-wbg", venue: "LIMITLESS", venueMarketId: "ll-wbg", canonicalTeamId: "weibo_gaming" }),
      buildRow({ interpretedContractId: "op-blg", venue: "OPINION", venueMarketId: "op-blg", canonicalTeamId: "bilibili_gaming" }),
      buildRow({ interpretedContractId: "op-al", venue: "OPINION", venueMarketId: "op-al", canonicalTeamId: "anyones_legend" }),
      buildRow({ interpretedContractId: "op-jdg", venue: "OPINION", venueMarketId: "op-jdg", canonicalTeamId: "jd_gaming" }),
      buildRow({ interpretedContractId: "op-tes", venue: "OPINION", venueMarketId: "op-tes", canonicalTeamId: "top_esports" }),
      buildRow({ interpretedContractId: "pm-blg", venue: "POLYMARKET", venueMarketId: "pm-blg", canonicalTeamId: "bilibili_gaming" }),
      buildRow({ interpretedContractId: "pm-al", venue: "POLYMARKET", venueMarketId: "pm-al", canonicalTeamId: "anyones_legend" }),
      buildRow({ interpretedContractId: "pm-jdg", venue: "POLYMARKET", venueMarketId: "pm-jdg", canonicalTeamId: "jd_gaming" }),
      buildRow({ interpretedContractId: "pm-tes", venue: "POLYMARKET", venueMarketId: "pm-tes", canonicalTeamId: "top_esports" }),
      buildRow({ interpretedContractId: "pm-wbg", venue: "POLYMARKET", venueMarketId: "pm-wbg", canonicalTeamId: "weibo_gaming" })
    ];

    const materialized = buildSportsLplWinner2026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(5);
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(materialized.finalDecision.exactSafeTriCandidateCount).toBe(4);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(5);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_LPL_WINNER_2026_TRI_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
