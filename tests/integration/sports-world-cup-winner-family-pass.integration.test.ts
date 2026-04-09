import { describe, expect, it } from "vitest";

import {
  buildSportsWorldCupWinnerFamilyArtifacts,
  type SportsWorldCupWinnerExtractedRow
} from "../../src/matching/sports/sports-world-cup-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsWorldCupWinnerExtractedRow>
): SportsWorldCupWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "2026 FIFA World Cup Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed team officially win the 2026 FIFA World Cup.",
  teamLabel: overrides.teamLabel ?? "Brazil"
});

describe("sports world cup winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling team legs", () => {
    const artifacts = buildSportsWorldCupWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-bra", venue: "OPINION", venueMarketId: "op-bra", teamLabel: "Brazil" }),
      buildRow({ interpretedContractId: "op-fra", venue: "OPINION", venueMarketId: "op-fra", teamLabel: "France" }),
      buildRow({ interpretedContractId: "op-eng", venue: "OPINION", venueMarketId: "op-eng", teamLabel: "England" }),
      buildRow({ interpretedContractId: "pm-bra", venue: "POLYMARKET", venueMarketId: "pm-bra", teamLabel: "Brazil" }),
      buildRow({ interpretedContractId: "pm-fra", venue: "POLYMARKET", venueMarketId: "pm-fra", teamLabel: "France" }),
      buildRow({ interpretedContractId: "pm-eng", venue: "POLYMARKET", venueMarketId: "pm-eng", teamLabel: "England" }),
      buildRow({ interpretedContractId: "pm-arg", venue: "POLYMARKET", venueMarketId: "pm-arg", teamLabel: "Argentina" }),
      buildRow({ interpretedContractId: "ll-bra", venue: "LIMITLESS", venueMarketId: "ll-bra", teamLabel: "Brazil" }),
      buildRow({ interpretedContractId: "ll-fra", venue: "LIMITLESS", venueMarketId: "ll-fra", teamLabel: "France" }),
      buildRow({ interpretedContractId: "ll-eng", venue: "LIMITLESS", venueMarketId: "ll-eng", teamLabel: "England" }),
      buildRow({ interpretedContractId: "ll-arg", venue: "LIMITLESS", venueMarketId: "ll-arg", teamLabel: "Argentina" }),
      buildRow({ interpretedContractId: "pr-bra", venue: "PREDICT", venueMarketId: "pr-bra", teamLabel: "Brazil" }),
      buildRow({ interpretedContractId: "pr-fra", venue: "PREDICT", venueMarketId: "pr-fra", teamLabel: "France" }),
      buildRow({ interpretedContractId: "pr-eng", venue: "PREDICT", venueMarketId: "pr-eng", teamLabel: "England" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", teamLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
