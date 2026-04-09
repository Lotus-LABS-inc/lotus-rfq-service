import { describe, expect, it } from "vitest";

import { buildSportsEplWinner20252026MatcherMaterialization } from "../../src/matching/sports/sports-epl-winner-2025-2026-matcher.js";
import type {
  SportsEplWinnerComparabilityTopicSummary,
  SportsEplWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-epl-winner-family-pass.js";

const buildRow = (overrides: Partial<SportsEplWinnerNormalizedTopicRow>): SportsEplWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "English Premier League Winner",
  canonicalFamily: "LEAGUE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
  canonicalCompetition: "EPL",
  canonicalSeason: "2025_2026",
  canonicalClubId: overrides.canonicalClubId ?? "arsenal",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<SportsEplWinnerComparabilityTopicSummary> = {}): SportsEplWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 6,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 6,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 3,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Arsenal",
    "Aston Villa",
    "Chelsea",
    "Liverpool",
    "Manchester City",
    "Manchester United"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Brentford", reason: "NOT_SHARED", venues: ["POLYMARKET"] },
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS", "PREDICT"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports epl winner 2025-2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict all-venue core to 3 clubs", () => {
    const normalizedTopics: SportsEplWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-ars", venue: "LIMITLESS", venueMarketId: "ll-ars", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "ll-villa", venue: "LIMITLESS", venueMarketId: "ll-villa", canonicalClubId: "aston_villa" }),
      buildRow({ interpretedContractId: "ll-che", venue: "LIMITLESS", venueMarketId: "ll-che", canonicalClubId: "chelsea" }),
      buildRow({ interpretedContractId: "ll-liv", venue: "LIMITLESS", venueMarketId: "ll-liv", canonicalClubId: "liverpool" }),
      buildRow({ interpretedContractId: "ll-city", venue: "LIMITLESS", venueMarketId: "ll-city", canonicalClubId: "manchester_city" }),
      buildRow({ interpretedContractId: "ll-utd", venue: "LIMITLESS", venueMarketId: "ll-utd", canonicalClubId: "manchester_united" }),
      buildRow({ interpretedContractId: "op-ars", venue: "OPINION", venueMarketId: "op-ars", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "op-city", venue: "OPINION", venueMarketId: "op-city", canonicalClubId: "manchester_city" }),
      buildRow({ interpretedContractId: "op-utd", venue: "OPINION", venueMarketId: "op-utd", canonicalClubId: "manchester_united" }),
      buildRow({ interpretedContractId: "op-liv", venue: "OPINION", venueMarketId: "op-liv", canonicalClubId: "liverpool" }),
      buildRow({ interpretedContractId: "pm-ars", venue: "POLYMARKET", venueMarketId: "pm-ars", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "pm-villa", venue: "POLYMARKET", venueMarketId: "pm-villa", canonicalClubId: "aston_villa" }),
      buildRow({ interpretedContractId: "pm-che", venue: "POLYMARKET", venueMarketId: "pm-che", canonicalClubId: "chelsea" }),
      buildRow({ interpretedContractId: "pm-liv", venue: "POLYMARKET", venueMarketId: "pm-liv", canonicalClubId: "liverpool" }),
      buildRow({ interpretedContractId: "pm-city", venue: "POLYMARKET", venueMarketId: "pm-city", canonicalClubId: "manchester_city" }),
      buildRow({ interpretedContractId: "pm-utd", venue: "POLYMARKET", venueMarketId: "pm-utd", canonicalClubId: "manchester_united" }),
      buildRow({ interpretedContractId: "pr-ars", venue: "PREDICT", venueMarketId: "pr-ars", canonicalClubId: "arsenal" }),
      buildRow({ interpretedContractId: "pr-villa", venue: "PREDICT", venueMarketId: "pr-villa", canonicalClubId: "aston_villa" }),
      buildRow({ interpretedContractId: "pr-che", venue: "PREDICT", venueMarketId: "pr-che", canonicalClubId: "chelsea" }),
      buildRow({ interpretedContractId: "pr-liv", venue: "PREDICT", venueMarketId: "pr-liv", canonicalClubId: "liverpool" }),
      buildRow({ interpretedContractId: "pr-city", venue: "PREDICT", venueMarketId: "pr-city", canonicalClubId: "manchester_city" })
    ];

    const materialized = buildSportsEplWinner20252026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(6);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(3);
    expect(materialized.allVenueLanes.map((lane) => lane.normalizedClubName)).toEqual([
      "arsenal",
      "liverpool",
      "manchester_city"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(6);
    expect(materialized.rejections.some((rejection) => rejection.reason === "OTHERS_EXCLUDED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "Brentford")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "manchester_united" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
