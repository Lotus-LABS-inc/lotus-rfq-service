import { describe, expect, it } from "vitest";

import {
  buildSportsNhlStanleyCupChampionFamilyArtifacts,
  type SportsNhlStanleyCupChampionExtractedRow
} from "../../src/matching/sports/sports-nhl-stanley-cup-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsNhlStanleyCupChampionExtractedRow>
): SportsNhlStanleyCupChampionExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "2026 NHL Stanley Cup Champion",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed team win the 2026 Stanley Cup.",
  teamLabel: overrides.teamLabel ?? "Florida Panthers"
});

describe("sports nhl stanley cup champion family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling team legs", () => {
    const artifacts = buildSportsNhlStanleyCupChampionFamilyArtifacts([
      buildRow({ interpretedContractId: "op-fla", venue: "OPINION", venueMarketId: "op-fla", teamLabel: "Florida Panthers" }),
      buildRow({ interpretedContractId: "op-col", venue: "OPINION", venueMarketId: "op-col", teamLabel: "Colorado Avalanche" }),
      buildRow({ interpretedContractId: "op-dal", venue: "OPINION", venueMarketId: "op-dal", teamLabel: "Dallas Stars" }),
      buildRow({ interpretedContractId: "op-edm", venue: "OPINION", venueMarketId: "op-edm", teamLabel: "Edmonton Oilers" }),
      buildRow({ interpretedContractId: "pm-fla", venue: "POLYMARKET", venueMarketId: "pm-fla", teamLabel: "Florida Panthers" }),
      buildRow({ interpretedContractId: "pm-col", venue: "POLYMARKET", venueMarketId: "pm-col", teamLabel: "Colorado Avalanche" }),
      buildRow({ interpretedContractId: "pm-dal", venue: "POLYMARKET", venueMarketId: "pm-dal", teamLabel: "Dallas Stars" }),
      buildRow({ interpretedContractId: "pm-edm", venue: "POLYMARKET", venueMarketId: "pm-edm", teamLabel: "Edmonton Oilers" }),
      buildRow({ interpretedContractId: "pm-tor", venue: "POLYMARKET", venueMarketId: "pm-tor", teamLabel: "Toronto Maple Leafs" }),
      buildRow({ interpretedContractId: "ll-fla", venue: "LIMITLESS", venueMarketId: "ll-fla", teamLabel: "Florida Panthers" }),
      buildRow({ interpretedContractId: "ll-col", venue: "LIMITLESS", venueMarketId: "ll-col", teamLabel: "Colorado Avalanche" }),
      buildRow({ interpretedContractId: "ll-dal", venue: "LIMITLESS", venueMarketId: "ll-dal", teamLabel: "Dallas Stars" }),
      buildRow({ interpretedContractId: "ll-edm", venue: "LIMITLESS", venueMarketId: "ll-edm", teamLabel: "Edmonton Oilers" }),
      buildRow({ interpretedContractId: "ll-tor", venue: "LIMITLESS", venueMarketId: "ll-tor", teamLabel: "Toronto Maple Leafs" }),
      buildRow({ interpretedContractId: "pr-fla", venue: "PREDICT", venueMarketId: "pr-fla", teamLabel: "Florida Panthers" }),
      buildRow({ interpretedContractId: "pr-col", venue: "PREDICT", venueMarketId: "pr-col", teamLabel: "Colorado Avalanche" }),
      buildRow({ interpretedContractId: "pr-dal", venue: "PREDICT", venueMarketId: "pr-dal", teamLabel: "Dallas Stars" }),
      buildRow({ interpretedContractId: "pr-edm", venue: "PREDICT", venueMarketId: "pr-edm", teamLabel: "Edmonton Oilers" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", teamLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(5);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
