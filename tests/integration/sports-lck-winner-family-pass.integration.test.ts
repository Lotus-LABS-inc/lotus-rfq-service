import { describe, expect, it } from "vitest";

import {
  buildSportsLckWinnerFamilyArtifacts,
  type SportsLckWinnerExtractedRow
} from "../../src/matching/sports/sports-lck-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsLckWinnerExtractedRow>
): SportsLckWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "LoL: LCK 2026 Season Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed team win the 2026 LCK season.",
  teamLabel: overrides.teamLabel ?? "Gen.G Esports"
});

describe("sports lck winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling team legs", () => {
    const artifacts = buildSportsLckWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-geng", venue: "OPINION", venueMarketId: "op-geng", teamLabel: "Gen.G Esports" }),
      buildRow({ interpretedContractId: "op-freecs", venue: "OPINION", venueMarketId: "op-freecs", teamLabel: "Freecs" }),
      buildRow({ interpretedContractId: "op-dplus", venue: "OPINION", venueMarketId: "op-dplus", teamLabel: "Dplus" }),
      buildRow({ interpretedContractId: "op-t1", venue: "OPINION", venueMarketId: "op-t1", teamLabel: "T1" }),
      buildRow({ interpretedContractId: "ll-geng", venue: "LIMITLESS", venueMarketId: "ll-geng", teamLabel: "Gen.G Esports" }),
      buildRow({ interpretedContractId: "ll-hle", venue: "LIMITLESS", venueMarketId: "ll-hle", teamLabel: "Hanwha Life Esports" }),
      buildRow({ interpretedContractId: "ll-dplus", venue: "LIMITLESS", venueMarketId: "ll-dplus", teamLabel: "Dplus" }),
      buildRow({ interpretedContractId: "ll-t1", venue: "LIMITLESS", venueMarketId: "ll-t1", teamLabel: "T1" }),
      buildRow({ interpretedContractId: "ll-kt", venue: "LIMITLESS", venueMarketId: "ll-kt", teamLabel: "KT Rolster" }),
      buildRow({ interpretedContractId: "pm-geng", venue: "POLYMARKET", venueMarketId: "pm-geng", teamLabel: "Gen.G" }),
      buildRow({ interpretedContractId: "pm-hle", venue: "POLYMARKET", venueMarketId: "pm-hle", teamLabel: "HLE" }),
      buildRow({ interpretedContractId: "pm-dplus", venue: "POLYMARKET", venueMarketId: "pm-dplus", teamLabel: "Dplus" }),
      buildRow({ interpretedContractId: "pm-t1", venue: "POLYMARKET", venueMarketId: "pm-t1", teamLabel: "T1" }),
      buildRow({ interpretedContractId: "pm-freecs", venue: "POLYMARKET", venueMarketId: "pm-freecs", teamLabel: "Freecs" }),
      buildRow({ interpretedContractId: "pm-kt", venue: "POLYMARKET", venueMarketId: "pm-kt", teamLabel: "KT Rolster" }),
      buildRow({ interpretedContractId: "pm-drx", venue: "POLYMARKET", venueMarketId: "pm-drx", teamLabel: "DRX" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|LEAGUE_WINNER|LCK|2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(6);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_LCK_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
