import { describe, expect, it } from "vitest";

import {
  buildSportsChampionsLeagueWinnerFamilyArtifacts,
  type SportsChampionsLeagueWinnerExtractedRow
} from "../../src/matching/sports/sports-champions-league-winner-family-pass.js";

const buildRow = (
  overrides: Partial<SportsChampionsLeagueWinnerExtractedRow>
): SportsChampionsLeagueWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "UEFA Champions League Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed club officially win the 2025-26 UEFA Champions League.",
  clubLabel: overrides.clubLabel ?? "Real Madrid"
});

describe("sports champions league winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling club legs", () => {
    const artifacts = buildSportsChampionsLeagueWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-real", venue: "OPINION", venueMarketId: "op-real", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "op-psg", venue: "OPINION", venueMarketId: "op-psg", clubLabel: "Paris Saint-Germain" }),
      buildRow({ interpretedContractId: "op-barca", venue: "OPINION", venueMarketId: "op-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "pm-real", venue: "POLYMARKET", venueMarketId: "pm-real", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "pm-psg", venue: "POLYMARKET", venueMarketId: "pm-psg", clubLabel: "Paris Saint-Germain" }),
      buildRow({ interpretedContractId: "pm-barca", venue: "POLYMARKET", venueMarketId: "pm-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "pm-arsenal", venue: "POLYMARKET", venueMarketId: "pm-arsenal", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "ll-real", venue: "LIMITLESS", venueMarketId: "ll-real", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "ll-psg", venue: "LIMITLESS", venueMarketId: "ll-psg", clubLabel: "Paris Saint-Germain" }),
      buildRow({ interpretedContractId: "ll-barca", venue: "LIMITLESS", venueMarketId: "ll-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "ll-arsenal", venue: "LIMITLESS", venueMarketId: "ll-arsenal", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "pr-real", venue: "PREDICT", venueMarketId: "pr-real", clubLabel: "Real Madrid" }),
      buildRow({ interpretedContractId: "pr-psg", venue: "PREDICT", venueMarketId: "pr-psg", clubLabel: "Paris Saint-Germain" }),
      buildRow({ interpretedContractId: "pr-barca", venue: "PREDICT", venueMarketId: "pr-barca", clubLabel: "Barcelona" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", clubLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
