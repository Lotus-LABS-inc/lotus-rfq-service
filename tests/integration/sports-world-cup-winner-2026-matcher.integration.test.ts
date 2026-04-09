import { describe, expect, it } from "vitest";

import { buildSportsWorldCupWinner2026MatcherMaterialization } from "../../src/matching/sports/sports-world-cup-winner-2026-matcher.js";
import type {
  SportsWorldCupWinnerComparabilityTopicSummary,
  SportsWorldCupWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-world-cup-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsWorldCupWinnerNormalizedTopicRow>
): SportsWorldCupWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 FIFA World Cup Winner",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
  canonicalCompetition: "FIFA_WORLD_CUP",
  canonicalSeason: "2026",
  canonicalTeamId: overrides.canonicalTeamId ?? "brazil",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsWorldCupWinnerComparabilityTopicSummary> = {}
): SportsWorldCupWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 14,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 4,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 1,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Argentina",
    "Belgium",
    "Brazil",
    "Croatia",
    "England",
    "France",
    "Germany",
    "Italy",
    "Mexico",
    "Netherlands",
    "Portugal",
    "Spain",
    "United States",
    "Uruguay"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports world cup winner 2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict tri core to the shared 3-venue teams", () => {
    const normalizedTopics: SportsWorldCupWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-bra", venue: "LIMITLESS", venueMarketId: "ll-bra", canonicalTeamId: "brazil" }),
      buildRow({ interpretedContractId: "ll-fra", venue: "LIMITLESS", venueMarketId: "ll-fra", canonicalTeamId: "france" }),
      buildRow({ interpretedContractId: "ll-eng", venue: "LIMITLESS", venueMarketId: "ll-eng", canonicalTeamId: "england" }),
      buildRow({ interpretedContractId: "ll-arg", venue: "LIMITLESS", venueMarketId: "ll-arg", canonicalTeamId: "argentina" }),
      buildRow({ interpretedContractId: "op-bra", venue: "OPINION", venueMarketId: "op-bra", canonicalTeamId: "brazil" }),
      buildRow({ interpretedContractId: "op-fra", venue: "OPINION", venueMarketId: "op-fra", canonicalTeamId: "france" }),
      buildRow({ interpretedContractId: "op-eng", venue: "OPINION", venueMarketId: "op-eng", canonicalTeamId: "england" }),
      buildRow({ interpretedContractId: "op-arg", venue: "OPINION", venueMarketId: "op-arg", canonicalTeamId: "argentina" }),
      buildRow({ interpretedContractId: "pm-bra", venue: "POLYMARKET", venueMarketId: "pm-bra", canonicalTeamId: "brazil" }),
      buildRow({ interpretedContractId: "pm-fra", venue: "POLYMARKET", venueMarketId: "pm-fra", canonicalTeamId: "france" }),
      buildRow({ interpretedContractId: "pm-eng", venue: "POLYMARKET", venueMarketId: "pm-eng", canonicalTeamId: "england" }),
      buildRow({ interpretedContractId: "pm-arg", venue: "POLYMARKET", venueMarketId: "pm-arg", canonicalTeamId: "argentina" }),
      buildRow({ interpretedContractId: "pm-ger", venue: "POLYMARKET", venueMarketId: "pm-ger", canonicalTeamId: "germany" }),
      buildRow({ interpretedContractId: "pr-bra", venue: "PREDICT", venueMarketId: "pr-bra", canonicalTeamId: "brazil" }),
      buildRow({ interpretedContractId: "pr-fra", venue: "PREDICT", venueMarketId: "pr-fra", canonicalTeamId: "france" }),
      buildRow({ interpretedContractId: "pr-eng", venue: "PREDICT", venueMarketId: "pr-eng", canonicalTeamId: "england" }),
      buildRow({ interpretedContractId: "pr-arg", venue: "PREDICT", venueMarketId: "pr-arg", canonicalTeamId: "argentina" })
    ];

    const materialized = buildSportsWorldCupWinner2026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary({ venuesPresent: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"], quadSharedNamedOutcomesCount: 4, triSharedNamedOutcomesCount: 14 })]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(4);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(4);
    expect(materialized.allVenueLanes.map((lane) => lane.normalizedTeamName)).toEqual([
      "argentina",
      "brazil",
      "england",
      "france"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(4);
    expect(materialized.rejections.some((rejection) => rejection.normalizedTeamName === "germany" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
