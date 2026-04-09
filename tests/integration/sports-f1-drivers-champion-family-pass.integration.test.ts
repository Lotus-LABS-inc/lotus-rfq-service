import { describe, expect, it } from "vitest";

import {
  buildSportsF1DriversChampionFamilyArtifacts,
  type SportsF1DriversChampionExtractedRow
} from "../../src/matching/sports/sports-f1-drivers-champion-family-pass.js";

const buildRow = (
  overrides: Partial<SportsF1DriversChampionExtractedRow>
): SportsF1DriversChampionExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceUrl: overrides.sourceUrl ?? "https://example.com",
  title: overrides.title ?? "2026 F1 Drivers' Champion",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if the listed driver wins the 2026 F1 Drivers Championship.",
  driverLabel: overrides.driverLabel ?? "George Russell"
});

describe("sports f1 drivers champion family pass", () => {
  it("builds a multi-venue matcher candidate from grouped sibling driver legs", () => {
    const artifacts = buildSportsF1DriversChampionFamilyArtifacts([
      buildRow({ interpretedContractId: "op-rus", venue: "OPINION", venueMarketId: "op-rus", driverLabel: "George Russell", title: "F1 World Drivers Champion 2026" }),
      buildRow({ interpretedContractId: "op-nor", venue: "OPINION", venueMarketId: "op-nor", driverLabel: "Lando Norris", title: "F1 World Drivers Champion 2026" }),
      buildRow({ interpretedContractId: "op-ver", venue: "OPINION", venueMarketId: "op-ver", driverLabel: "Max Verstappen", title: "F1 World Drivers Champion 2026" }),
      buildRow({ interpretedContractId: "op-pia", venue: "OPINION", venueMarketId: "op-pia", driverLabel: "Oscar Piastri", title: "F1 World Drivers Champion 2026" }),
      buildRow({ interpretedContractId: "pm-rus", venue: "POLYMARKET", venueMarketId: "pm-rus", driverLabel: "George Russell" }),
      buildRow({ interpretedContractId: "pm-nor", venue: "POLYMARKET", venueMarketId: "pm-nor", driverLabel: "Lando Norris" }),
      buildRow({ interpretedContractId: "pm-ver", venue: "POLYMARKET", venueMarketId: "pm-ver", driverLabel: "Max Verstappen" }),
      buildRow({ interpretedContractId: "pm-lec", venue: "POLYMARKET", venueMarketId: "pm-lec", driverLabel: "Charles Leclerc" }),
      buildRow({ interpretedContractId: "pm-ant", venue: "POLYMARKET", venueMarketId: "pm-ant", driverLabel: "Kimi Antonelli" }),
      buildRow({ interpretedContractId: "ll-rus", venue: "LIMITLESS", venueMarketId: "ll-rus", driverLabel: "George Russell" }),
      buildRow({ interpretedContractId: "ll-nor", venue: "LIMITLESS", venueMarketId: "ll-nor", driverLabel: "Lando Norris" }),
      buildRow({ interpretedContractId: "ll-ver", venue: "LIMITLESS", venueMarketId: "ll-ver", driverLabel: "Max Verstappen" }),
      buildRow({ interpretedContractId: "ll-lec", venue: "LIMITLESS", venueMarketId: "ll-lec", driverLabel: "Charles Leclerc" }),
      buildRow({ interpretedContractId: "ll-pia", venue: "LIMITLESS", venueMarketId: "ll-pia", driverLabel: "Oscar Piastri" }),
      buildRow({ interpretedContractId: "ll-lec", venue: "LIMITLESS", venueMarketId: "ll-lec-2", driverLabel: "Charles Leclerc" }),
      buildRow({ interpretedContractId: "ll-ant", venue: "LIMITLESS", venueMarketId: "ll-ant", driverLabel: "Kimi Antonelli" }),
      buildRow({ interpretedContractId: "ll-ham", venue: "LIMITLESS", venueMarketId: "ll-ham", driverLabel: "Lewis Hamilton" }),
      buildRow({ interpretedContractId: "ll-alo", venue: "LIMITLESS", venueMarketId: "ll-alo", driverLabel: "Fernando Alonso" }),
      buildRow({ interpretedContractId: "pr-rus", venue: "PREDICT", venueMarketId: "pr-rus", driverLabel: "George Russell" }),
      buildRow({ interpretedContractId: "pr-nor", venue: "PREDICT", venueMarketId: "pr-nor", driverLabel: "Lando Norris" }),
      buildRow({ interpretedContractId: "pr-ver", venue: "PREDICT", venueMarketId: "pr-ver", driverLabel: "Max Verstappen" }),
      buildRow({ interpretedContractId: "pr-lec", venue: "PREDICT", venueMarketId: "pr-lec", driverLabel: "Charles Leclerc" }),
      buildRow({ interpretedContractId: "pr-pia", venue: "PREDICT", venueMarketId: "pr-pia", driverLabel: "Oscar Piastri" }),
      buildRow({ interpretedContractId: "pr-ant", venue: "PREDICT", venueMarketId: "pr-ant", driverLabel: "Kimi Antonelli" }),
      buildRow({ interpretedContractId: "pr-ham", venue: "PREDICT", venueMarketId: "pr-ham", driverLabel: "Lewis Hamilton" }),
      buildRow({ interpretedContractId: "pr-alo", venue: "PREDICT", venueMarketId: "pr-alo", driverLabel: "Fernando Alonso" }),
      buildRow({ interpretedContractId: "pr-other", venue: "PREDICT", venueMarketId: "pr-other", driverLabel: "Other" })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(8);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(6);
    expect(artifacts.comparabilitySummary[0]?.quadSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.admissionSummary.rowsRejectedByReason.OTHERS_EXCLUDED).toBe(1);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND");
  });
});
