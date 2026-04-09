import { describe, expect, it } from "vitest";

import { buildEplMarket, buildLolMarket, buildValorantMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-fixture-discovery", () => {
  it("emits the new discovery summary and held pocket references", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" }),
        buildValorantMarket({ interpretedContractId: "val-op", venue: "OPINION" }),
        buildLolMarket({ interpretedContractId: "lol-op", venue: "OPINION" })
      ]
    });

    expect(artifacts.discoverySummary.sportsFrontierPosition).toBe("SECONDARY_PARALLEL_DISCOVERY_TRACK");
    expect(artifacts.scope.heldPocketReferences).toEqual([
      "ESPORTS|MATCHUP_WINNER|KPL",
      "ESPORTS|MATCHUP_WINNER|LCK"
    ]);
    expect(artifacts.discoverySummary.activeScope).toEqual([
      "SPORTS|MATCHUP_WINNER|EPL",
      "SPORTS|MATCHUP_WINNER|LA_LIGA",
      "ESPORTS|MATCHUP_WINNER|VALORANT",
      "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"
    ]);
  });
});
