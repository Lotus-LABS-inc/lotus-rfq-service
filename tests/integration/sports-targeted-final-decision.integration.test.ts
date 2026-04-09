import { describe, expect, it } from "vitest";

import { buildEplMarket, buildLaLigaMarket, buildLolMarket, buildValorantMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-final-decision", () => {
  it("locks the new priority order and keeps sports secondary unless real overlap appears", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" }),
        buildLaLigaMarket({ interpretedContractId: "laliga-op", venue: "OPINION" }),
        buildValorantMarket({ interpretedContractId: "val-op", venue: "OPINION" }),
        buildLolMarket({ interpretedContractId: "lol-op", venue: "OPINION" })
      ]
    });

    expect(artifacts.pocketPriority.pockets.map((entry) => entry.pocket)).toEqual([
      "SPORTS|MATCHUP_WINNER|EPL",
      "SPORTS|MATCHUP_WINNER|LA_LIGA",
      "ESPORTS|MATCHUP_WINNER|VALORANT",
      "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"
    ]);
    expect(artifacts.finalDecision.sportsRemainsSecondaryToCrypto).toBe(true);
    expect(artifacts.finalDecision.singleBestNextSportsAction).toBe("HOLD_POCKET_WAIT_FOR_SUPPLY");
    expect(artifacts.priorityShiftSummary.heldSupersededPockets).toEqual([
      "ESPORTS|MATCHUP_WINNER|KPL",
      "ESPORTS|MATCHUP_WINNER|LCK"
    ]);
  });
});
