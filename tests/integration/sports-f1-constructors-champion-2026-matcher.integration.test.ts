import { describe, expect, it } from "vitest";

import { buildSportsF1ConstructorsChampion2026MatcherMaterialization } from "../../src/matching/sports/sports-f1-constructors-champion-2026-matcher.js";
import type {
  SportsF1ConstructorsChampionComparabilityTopicSummary,
  SportsF1ConstructorsChampionNormalizedTopicRow
} from "../../src/matching/sports/sports-f1-constructors-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsF1ConstructorsChampionNormalizedTopicRow>
): SportsF1ConstructorsChampionNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "F1 Constructors' Champion",
  canonicalFamily: "TOURNAMENT_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
  canonicalCompetition: "F1_CONSTRUCTORS_CHAMPIONSHIP",
  canonicalSeason: "2026",
  canonicalConstructorId: overrides.canonicalConstructorId ?? "mclaren",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<SportsF1ConstructorsChampionComparabilityTopicSummary> = {}
): SportsF1ConstructorsChampionComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 7,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 4,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 0,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Aston Martin",
    "Audi",
    "Ferrari",
    "McLaren",
    "Mercedes",
    "Red Bull Racing",
    "Williams"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [],
  notes: overrides.notes ?? []
});

describe("sports f1 constructors champion 2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict tri core to the shared 3-venue constructors", () => {
    const normalizedTopics: SportsF1ConstructorsChampionNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-mcl", venue: "LIMITLESS", venueMarketId: "ll-mcl", canonicalConstructorId: "mclaren" }),
      buildRow({ interpretedContractId: "ll-fer", venue: "LIMITLESS", venueMarketId: "ll-fer", canonicalConstructorId: "ferrari" }),
      buildRow({ interpretedContractId: "ll-mer", venue: "LIMITLESS", venueMarketId: "ll-mer", canonicalConstructorId: "mercedes" }),
      buildRow({ interpretedContractId: "ll-rbr", venue: "LIMITLESS", venueMarketId: "ll-rbr", canonicalConstructorId: "red_bull_racing" }),
      buildRow({ interpretedContractId: "ll-ast", venue: "LIMITLESS", venueMarketId: "ll-ast", canonicalConstructorId: "aston_martin" }),
      buildRow({ interpretedContractId: "ll-aud", venue: "LIMITLESS", venueMarketId: "ll-aud", canonicalConstructorId: "audi" }),
      buildRow({ interpretedContractId: "ll-wil", venue: "LIMITLESS", venueMarketId: "ll-wil", canonicalConstructorId: "williams" }),
      buildRow({ interpretedContractId: "op-mcl", venue: "OPINION", venueMarketId: "op-mcl", canonicalConstructorId: "mclaren" }),
      buildRow({ interpretedContractId: "op-fer", venue: "OPINION", venueMarketId: "op-fer", canonicalConstructorId: "ferrari" }),
      buildRow({ interpretedContractId: "op-mer", venue: "OPINION", venueMarketId: "op-mer", canonicalConstructorId: "mercedes" }),
      buildRow({ interpretedContractId: "op-rbr", venue: "OPINION", venueMarketId: "op-rbr", canonicalConstructorId: "red_bull_racing" }),
      buildRow({ interpretedContractId: "pm-mcl", venue: "POLYMARKET", venueMarketId: "pm-mcl", canonicalConstructorId: "mclaren" }),
      buildRow({ interpretedContractId: "pm-fer", venue: "POLYMARKET", venueMarketId: "pm-fer", canonicalConstructorId: "ferrari" }),
      buildRow({ interpretedContractId: "pm-mer", venue: "POLYMARKET", venueMarketId: "pm-mer", canonicalConstructorId: "mercedes" }),
      buildRow({ interpretedContractId: "pm-rbr", venue: "POLYMARKET", venueMarketId: "pm-rbr", canonicalConstructorId: "red_bull_racing" }),
      buildRow({ interpretedContractId: "pm-ast", venue: "POLYMARKET", venueMarketId: "pm-ast", canonicalConstructorId: "aston_martin" }),
      buildRow({ interpretedContractId: "pm-aud", venue: "POLYMARKET", venueMarketId: "pm-aud", canonicalConstructorId: "audi" }),
      buildRow({ interpretedContractId: "pm-wil", venue: "POLYMARKET", venueMarketId: "pm-wil", canonicalConstructorId: "williams" })
    ];

    const materialized = buildSportsF1ConstructorsChampion2026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(7);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBeNull();
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(0);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(7);
    expect(materialized.rejections.some((rejection) => rejection.normalizedConstructorName === "aston_martin" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_F1_CONSTRUCTORS_CHAMPION_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
  });
});
