import { describe, expect, it } from "vitest";

import {
  buildSportsLplWinnerFamilyArtifacts,
  type SportsLplWinnerExtractedRow
} from "../../src/matching/sports/sports-lpl-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsLplWinnerExtractedRow>
): SportsLplWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "LoL: LPL 2026 Season Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed team win the 2026 LPL season.",
  teamLabel: overrides.teamLabel ?? "Bilibili Gaming"
});

describe("sports lpl winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling team legs", () => {
    const artifacts = buildSportsLplWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-blg", venue: "OPINION", venueMarketId: "op-blg", teamLabel: "Bilibili Gaming" }),
      buildRow({ interpretedContractId: "op-al", venue: "OPINION", venueMarketId: "op-al", teamLabel: "Anyone's Legend" }),
      buildRow({ interpretedContractId: "op-jdg", venue: "OPINION", venueMarketId: "op-jdg", teamLabel: "JD Gaming" }),
      buildRow({ interpretedContractId: "op-tes", venue: "OPINION", venueMarketId: "op-tes", teamLabel: "Top Esports" }),
      buildRow({ interpretedContractId: "ll-blg", venue: "LIMITLESS", venueMarketId: "ll-blg", teamLabel: "Bilibili Gaming" }),
      buildRow({ interpretedContractId: "ll-al", venue: "LIMITLESS", venueMarketId: "ll-al", teamLabel: "Anyone's Legend" }),
      buildRow({ interpretedContractId: "ll-jdg", venue: "LIMITLESS", venueMarketId: "ll-jdg", teamLabel: "JD Gaming" }),
      buildRow({ interpretedContractId: "ll-tes", venue: "LIMITLESS", venueMarketId: "ll-tes", teamLabel: "Top Esports" }),
      buildRow({ interpretedContractId: "ll-wbg", venue: "LIMITLESS", venueMarketId: "ll-wbg", teamLabel: "Weibo Gaming" }),
      buildRow({ interpretedContractId: "pm-blg", venue: "POLYMARKET", venueMarketId: "pm-blg", teamLabel: "Bilibili Gaming" }),
      buildRow({ interpretedContractId: "pm-al", venue: "POLYMARKET", venueMarketId: "pm-al", teamLabel: "Anyone's Legend" }),
      buildRow({ interpretedContractId: "pm-jdg", venue: "POLYMARKET", venueMarketId: "pm-jdg", teamLabel: "JD Gaming" }),
      buildRow({ interpretedContractId: "pm-tes", venue: "POLYMARKET", venueMarketId: "pm-tes", teamLabel: "Top Esports" }),
      buildRow({ interpretedContractId: "pm-wbg", venue: "POLYMARKET", venueMarketId: "pm-wbg", teamLabel: "Weibo Gaming" }),
      buildRow({ interpretedContractId: "pm-ig", venue: "POLYMARKET", venueMarketId: "pm-ig", teamLabel: "Invictus Gaming" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|LEAGUE_WINNER|LPL|2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(5);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_LPL_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
