import { describe, expect, it } from "vitest";

import {
  buildSportsNbaChampionFamilyArtifacts,
  type SportsNbaChampionExtractedRow
} from "../../src/matching/sports/sports-nba-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsNbaChampionExtractedRow>
): SportsNbaChampionExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "2026 NBA Champion",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed team win the 2026 NBA Finals.",
  teamLabel: overrides.teamLabel ?? "Oklahoma City Thunder"
});

describe("sports nba champion family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling team legs", () => {
    const artifacts = buildSportsNbaChampionFamilyArtifacts([
      buildRow({ interpretedContractId: "op-okc", venue: "OPINION", venueMarketId: "op-okc", teamLabel: "Oklahoma City Thunder" }),
      buildRow({ interpretedContractId: "op-det", venue: "OPINION", venueMarketId: "op-det", teamLabel: "Detroit Pistons" }),
      buildRow({ interpretedContractId: "op-sas", venue: "OPINION", venueMarketId: "op-sas", teamLabel: "San Antonio Spurs" }),
      buildRow({ interpretedContractId: "op-bos", venue: "OPINION", venueMarketId: "op-bos", teamLabel: "Boston Celtics" }),
      buildRow({ interpretedContractId: "pm-okc", venue: "POLYMARKET", venueMarketId: "pm-okc", teamLabel: "Oklahoma City Thunder" }),
      buildRow({ interpretedContractId: "pm-det", venue: "POLYMARKET", venueMarketId: "pm-det", teamLabel: "Detroit Pistons" }),
      buildRow({ interpretedContractId: "pm-sas", venue: "POLYMARKET", venueMarketId: "pm-sas", teamLabel: "San Antonio Spurs" }),
      buildRow({ interpretedContractId: "pm-bos", venue: "POLYMARKET", venueMarketId: "pm-bos", teamLabel: "Boston Celtics" }),
      buildRow({ interpretedContractId: "pm-den", venue: "POLYMARKET", venueMarketId: "pm-den", teamLabel: "Denver Nuggets" }),
      buildRow({ interpretedContractId: "ll-okc", venue: "LIMITLESS", venueMarketId: "ll-okc", teamLabel: "Oklahoma City Thunder" }),
      buildRow({ interpretedContractId: "ll-det", venue: "LIMITLESS", venueMarketId: "ll-det", teamLabel: "Detroit Pistons" }),
      buildRow({ interpretedContractId: "ll-sas", venue: "LIMITLESS", venueMarketId: "ll-sas", teamLabel: "San Antonio Spurs" }),
      buildRow({ interpretedContractId: "ll-bos", venue: "LIMITLESS", venueMarketId: "ll-bos", teamLabel: "Boston Celtics" }),
      buildRow({ interpretedContractId: "ll-den", venue: "LIMITLESS", venueMarketId: "ll-den", teamLabel: "Denver Nuggets" }),
      buildRow({ interpretedContractId: "pr-okc", venue: "PREDICT", venueMarketId: "pr-okc", teamLabel: "Oklahoma City Thunder" }),
      buildRow({ interpretedContractId: "pr-det", venue: "PREDICT", venueMarketId: "pr-det", teamLabel: "Detroit Pistons" }),
      buildRow({ interpretedContractId: "pr-sas", venue: "PREDICT", venueMarketId: "pr-sas", teamLabel: "San Antonio Spurs" }),
      buildRow({ interpretedContractId: "pr-bos", venue: "PREDICT", venueMarketId: "pr-bos", teamLabel: "Boston Celtics" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", teamLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|NBA|2025_2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(5);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
