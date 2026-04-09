import { describe, expect, it } from "vitest";

import { buildSportsLaLigaWinner20252026MatcherMaterialization } from "../../src/matching/sports/sports-la-liga-winner-2025-2026-matcher.js";
import type {
  SportsLaLigaWinnerComparabilityTopicSummary,
  SportsLaLigaWinnerNormalizedTopicRow
} from "../../src/matching/sports/sports-la-liga-winner-family-pass.js";

const buildRow = (overrides: Partial<SportsLaLigaWinnerNormalizedTopicRow>): SportsLaLigaWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "La Liga Winner",
  canonicalFamily: "LEAGUE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026",
  canonicalCompetition: "LA_LIGA",
  canonicalSeason: "2025_2026",
  canonicalClubId: overrides.canonicalClubId ?? "barcelona",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<SportsLaLigaWinnerComparabilityTopicSummary> = {}): SportsLaLigaWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 4,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 4,
  quadSharedNamedOutcomesCount: overrides.quadSharedNamedOutcomesCount ?? 3,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 6,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_CORE_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "Atletico Madrid",
    "Barcelona",
    "Real Madrid",
    "Villarreal"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Real Betis", reason: "NOT_SHARED", venues: ["POLYMARKET"] },
    { label: "Athletic Bilbao", reason: "NOT_SHARED", venues: ["POLYMARKET"] }
  ],
  notes: overrides.notes ?? []
});

describe("sports la liga winner 2025-2026 matcher", () => {
  it("preserves the broader pair core while keeping the strict all-venue core to 3 clubs", () => {
    const normalizedTopics: SportsLaLigaWinnerNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "ll-barca", venue: "LIMITLESS", venueMarketId: "ll-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "ll-madrid", venue: "LIMITLESS", venueMarketId: "ll-madrid", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "ll-atleti", venue: "LIMITLESS", venueMarketId: "ll-atleti", canonicalClubId: "atletico_madrid" }),
      buildRow({ interpretedContractId: "ll-villarreal", venue: "LIMITLESS", venueMarketId: "ll-villarreal", canonicalClubId: "villarreal" }),
      buildRow({ interpretedContractId: "op-barca", venue: "OPINION", venueMarketId: "op-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "op-madrid", venue: "OPINION", venueMarketId: "op-madrid", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "op-atleti", venue: "OPINION", venueMarketId: "op-atleti", canonicalClubId: "atletico_madrid" }),
      buildRow({ interpretedContractId: "pm-barca", venue: "POLYMARKET", venueMarketId: "pm-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "pm-madrid", venue: "POLYMARKET", venueMarketId: "pm-madrid", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "pm-atleti", venue: "POLYMARKET", venueMarketId: "pm-atleti", canonicalClubId: "atletico_madrid" }),
      buildRow({ interpretedContractId: "pm-villarreal", venue: "POLYMARKET", venueMarketId: "pm-villarreal", canonicalClubId: "villarreal" }),
      buildRow({ interpretedContractId: "pr-barca", venue: "PREDICT", venueMarketId: "pr-barca", canonicalClubId: "barcelona" }),
      buildRow({ interpretedContractId: "pr-madrid", venue: "PREDICT", venueMarketId: "pr-madrid", canonicalClubId: "real_madrid" }),
      buildRow({ interpretedContractId: "pr-atleti", venue: "PREDICT", venueMarketId: "pr-atleti", canonicalClubId: "atletico_madrid" }),
      buildRow({ interpretedContractId: "pr-villarreal", venue: "PREDICT", venueMarketId: "pr-villarreal", canonicalClubId: "villarreal" })
    ];

    const materialized = buildSportsLaLigaWinner20252026MatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(4);
    expect(materialized.finalDecision.bestAllVenueIfAny).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafeAllVenueCandidateCount).toBe(3);
    expect(materialized.allVenueLanes.map((lane) => lane.normalizedClubName)).toEqual([
      "atletico_madrid",
      "barcelona",
      "real_madrid"
    ]);
    expect(materialized.pairLanes.filter((lane) => lane.venuePair === "LIMITLESS|POLYMARKET")).toHaveLength(4);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "Real Betis")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.normalizedClubName === "villarreal" && rejection.reason === "ALL_VENUE_EDGE_MISSING")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_REVIEW_REQUIRED_PAIR_FIRST");
  });
});
