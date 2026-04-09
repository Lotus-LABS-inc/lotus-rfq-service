import { describe, expect, it } from "vitest";

import {
  buildSportsLaLigaWinnerFamilyArtifacts,
  type SportsLaLigaWinnerExtractedRow
} from "../../src/matching/sports/sports-la-liga-winner-family-pass.js";

const buildRow = (overrides: Partial<SportsLaLigaWinnerExtractedRow>): SportsLaLigaWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "La Liga Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed club officially win the 2025–26 La Liga.",
  clubLabel: overrides.clubLabel ?? "Barcelona"
});

describe("sports la liga winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling club legs", () => {
    const artifacts = buildSportsLaLigaWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-barca", venue: "OPINION", venueMarketId: "op-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "op-madrid", venue: "OPINION", venueMarketId: "op-madrid", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "op-atleti", venue: "OPINION", venueMarketId: "op-atleti", clubLabel: "Atletico Madrid" }),
      buildRow({ interpretedContractId: "pm-barca", venue: "POLYMARKET", venueMarketId: "pm-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "pm-madrid", venue: "POLYMARKET", venueMarketId: "pm-madrid", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "pm-atleti", venue: "POLYMARKET", venueMarketId: "pm-atleti", clubLabel: "Atletico Madrid" }),
      buildRow({ interpretedContractId: "pm-villarreal", venue: "POLYMARKET", venueMarketId: "pm-villarreal", clubLabel: "Villarreal" }),
      buildRow({ interpretedContractId: "ll-barca", venue: "LIMITLESS", venueMarketId: "ll-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "ll-madrid", venue: "LIMITLESS", venueMarketId: "ll-madrid", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "ll-atleti", venue: "LIMITLESS", venueMarketId: "ll-atleti", clubLabel: "Atletico Madrid" }),
      buildRow({ interpretedContractId: "ll-villarreal", venue: "LIMITLESS", venueMarketId: "ll-villarreal", clubLabel: "Villarreal" }),
      buildRow({ interpretedContractId: "pr-barca", venue: "PREDICT", venueMarketId: "pr-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "pr-madrid", venue: "PREDICT", venueMarketId: "pr-madrid", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "pr-atleti", venue: "PREDICT", venueMarketId: "pr-atleti", clubLabel: "Atletico Madrid" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", clubLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
