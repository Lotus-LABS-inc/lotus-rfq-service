import { describe, expect, it } from "vitest";

import {
  buildSportsF1ConstructorsChampionFamilyArtifacts,
  type SportsF1ConstructorsChampionExtractedRow
} from "../../src/matching/sports/sports-f1-constructors-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsF1ConstructorsChampionExtractedRow>
): SportsF1ConstructorsChampionExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "F1 Constructors' Champion 2026",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed constructor wins the 2026 F1 Constructors Championship.",
  constructorLabel: overrides.constructorLabel ?? "McLaren"
});

describe("sports f1 constructors champion family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling constructor legs", () => {
    const artifacts = buildSportsF1ConstructorsChampionFamilyArtifacts([
      buildRow({ interpretedContractId: "op-mer", venue: "OPINION", venueMarketId: "op-mer", constructorLabel: "Mercedes" }),
      buildRow({ interpretedContractId: "op-fer", venue: "OPINION", venueMarketId: "op-fer", constructorLabel: "Ferrari" }),
      buildRow({ interpretedContractId: "op-mcl", venue: "OPINION", venueMarketId: "op-mcl", constructorLabel: "McLaren" }),
      buildRow({ interpretedContractId: "op-rbr", venue: "OPINION", venueMarketId: "op-rbr", constructorLabel: "Red Bull Racing" }),
      buildRow({ interpretedContractId: "pm-mer", venue: "POLYMARKET", venueMarketId: "pm-mer", constructorLabel: "Mercedes" }),
      buildRow({ interpretedContractId: "pm-fer", venue: "POLYMARKET", venueMarketId: "pm-fer", constructorLabel: "Ferrari" }),
      buildRow({ interpretedContractId: "pm-mcl", venue: "POLYMARKET", venueMarketId: "pm-mcl", constructorLabel: "McLaren" }),
      buildRow({ interpretedContractId: "pm-rbr", venue: "POLYMARKET", venueMarketId: "pm-rbr", constructorLabel: "Red Bull Racing" }),
      buildRow({ interpretedContractId: "pm-amr", venue: "POLYMARKET", venueMarketId: "pm-amr", constructorLabel: "Aston Martin" }),
      buildRow({ interpretedContractId: "ll-mer", venue: "LIMITLESS", venueMarketId: "ll-mer", constructorLabel: "Mercedes" }),
      buildRow({ interpretedContractId: "ll-fer", venue: "LIMITLESS", venueMarketId: "ll-fer", constructorLabel: "Ferrari" }),
      buildRow({ interpretedContractId: "ll-mcl", venue: "LIMITLESS", venueMarketId: "ll-mcl", constructorLabel: "McLaren" }),
      buildRow({ interpretedContractId: "ll-rbr", venue: "LIMITLESS", venueMarketId: "ll-rbr", constructorLabel: "Red Bull Racing" }),
      buildRow({ interpretedContractId: "ll-amr", venue: "LIMITLESS", venueMarketId: "ll-amr", constructorLabel: "Aston Martin" }),
      buildRow({ interpretedContractId: "ll-other", venue: "LIMITLESS", venueMarketId: "ll-other", constructorLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(5);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(0);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
