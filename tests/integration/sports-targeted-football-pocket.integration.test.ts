import { describe, expect, it } from "vitest";

import { buildEplMarket, buildLaLigaMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-football-pocket", () => {
  it("keeps EPL and La Liga separated and order-invariant", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" }),
        buildEplMarket({ interpretedContractId: "epl-pm", venue: "POLYMARKET", title: "Premier League: Chelsea vs Arsenal (Apr 3 7:00PM ET)" }),
        buildLaLigaMarket({ interpretedContractId: "laliga-op", venue: "OPINION" })
      ]
    });

    expect(artifacts.discoverySummary.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.targetFixtureCount).toBe(1);
    expect(artifacts.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.comparableOverlapCount).toBe(1);
    expect(artifacts.discoverySummary.pockets["SPORTS|MATCHUP_WINNER|LA_LIGA"]?.targetFixtureCount).toBe(1);
    expect(artifacts.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|LA_LIGA"]?.comparableOverlapCount).toBe(0);
  });

  it("rejects unrelated football rows from the targeted scope", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" }),
        buildLaLigaMarket({
          interpretedContractId: "club-world-cup",
          venue: "POLYMARKET",
          title: "FIFA Club World Cup: Real Madrid vs Barcelona (Apr 4 3:00PM ET)",
          rulesText: "FIFA Club World Cup matchup winner for Apr 4 at 3:00PM ET."
        })
      ]
    });

    expect(artifacts.discoverySummary.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.targetFixtureCount).toBe(1);
    expect(artifacts.discoverySummary.pockets["SPORTS|MATCHUP_WINNER|LA_LIGA"]?.discoveredRowsByVenue["POLYMARKET"]).toBe(0);
  });
});
