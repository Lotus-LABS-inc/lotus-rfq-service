import { describe, expect, it } from "vitest";

import {
  buildSportsEplWinnerFamilyArtifacts,
  type SportsEplWinnerExtractedRow
} from "../../src/matching/sports/sports-epl-winner-family-pass.js";

const buildRow = (overrides: Partial<SportsEplWinnerExtractedRow>): SportsEplWinnerExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "English Premier League Winner",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed club officially win the 2025–26 English Premier League.",
  clubLabel: overrides.clubLabel ?? "Arsenal"
});

describe("sports epl winner family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling club legs", () => {
    const artifacts = buildSportsEplWinnerFamilyArtifacts([
      buildRow({ interpretedContractId: "op-ars", venue: "OPINION", venueMarketId: "op-ars", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "op-city", venue: "OPINION", venueMarketId: "op-city", clubLabel: "Man City" }),
      buildRow({ interpretedContractId: "op-utd", venue: "OPINION", venueMarketId: "op-utd", clubLabel: "Man United" }),
      buildRow({ interpretedContractId: "op-liv", venue: "OPINION", venueMarketId: "op-liv", clubLabel: "Liverpool" }),
      buildRow({ interpretedContractId: "pm-ars", venue: "POLYMARKET", venueMarketId: "pm-ars", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "pm-city", venue: "POLYMARKET", venueMarketId: "pm-city", clubLabel: "Manchester City" }),
      buildRow({ interpretedContractId: "pm-utd", venue: "POLYMARKET", venueMarketId: "pm-utd", clubLabel: "Manchester United" }),
      buildRow({ interpretedContractId: "pm-liv", venue: "POLYMARKET", venueMarketId: "pm-liv", clubLabel: "Liverpool" }),
      buildRow({ interpretedContractId: "ll-ars", venue: "LIMITLESS", venueMarketId: "ll-ars", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "ll-city", venue: "LIMITLESS", venueMarketId: "ll-city", clubLabel: "Man City" }),
      buildRow({ interpretedContractId: "ll-utd", venue: "LIMITLESS", venueMarketId: "ll-utd", clubLabel: "Man United" }),
      buildRow({ interpretedContractId: "ll-liv", venue: "LIMITLESS", venueMarketId: "ll-liv", clubLabel: "Liverpool" }),
      buildRow({ interpretedContractId: "ll-villa", venue: "LIMITLESS", venueMarketId: "ll-villa", clubLabel: "Aston Villa" }),
      buildRow({ interpretedContractId: "pr-ars", venue: "PREDICT", venueMarketId: "pr-ars", clubLabel: "Arsenal" }),
      buildRow({ interpretedContractId: "pr-city", venue: "PREDICT", venueMarketId: "pr-city", clubLabel: "Man City" }),
      buildRow({ interpretedContractId: "pr-liv", venue: "PREDICT", venueMarketId: "pr-liv", clubLabel: "Liverpool" }),
      buildRow({ interpretedContractId: "pr-villa", venue: "PREDICT", venueMarketId: "pr-villa", clubLabel: "Aston Villa" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", clubLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|LEAGUE_WINNER|EPL|2025_2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(5);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(4);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_EPL_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
