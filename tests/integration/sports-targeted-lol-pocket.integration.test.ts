import { describe, expect, it } from "vitest";

import { buildLolMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-lol-pocket", () => {
  it("keeps LoL competitions separated internally while rolling them up to the LoL bucket", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildLolMarket({ interpretedContractId: "lol-lec", venue: "OPINION", title: "LEC: G2 vs Fnatic (Apr 4 1:00PM ET)" }),
        buildLolMarket({ interpretedContractId: "lol-lck", venue: "POLYMARKET", title: "LCK: T1 vs Gen G (Apr 4 1:00PM ET)", teams: ["T1", "Gen G"] })
      ]
    });

    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"]?.competitionCounts["lec"]).toBe(1);
    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"]?.competitionCounts["lck"]).toBe(1);
    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"]?.targetFixtureCount).toBe(2);
  });

  it("does not merge unresolved generic LoL rows into the scoped LoL pocket", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildLolMarket({ interpretedContractId: "lol-lec", venue: "OPINION" }),
        buildLolMarket({
          interpretedContractId: "lol-generic",
          venue: "PREDICT",
          title: "League of Legends: G2 vs Fnatic (Apr 4 1:00PM ET)",
          rulesText: "Generic League of Legends matchup winner for Apr 4 at 1:00PM ET."
        })
      ]
    });

    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"]?.discoveredRowsByVenue["PREDICT"]).toBe(0);
  });
});
