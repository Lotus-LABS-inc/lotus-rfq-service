import { describe, expect, it } from "vitest";

import { buildEplMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-overlap", () => {
  it("reports real 2+ venue overlap and non-comparable basis overlap", async () => {
    const comparable = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" }),
        buildEplMarket({ interpretedContractId: "epl-pm", venue: "POLYMARKET", title: "EPL: Chelsea vs Arsenal (Apr 3 7:00PM ET)" })
      ]
    });

    expect(comparable.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.twoPlusVenueOverlapCount).toBe(1);
    expect(comparable.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.comparableOverlapCount).toBe(1);

    const nonComparable = await runSportsTargetedArtifacts({
      markets: [
        buildEplMarket({ interpretedContractId: "epl-op-live", venue: "OPINION" }),
        buildEplMarket({
          interpretedContractId: "epl-pm-historical",
          venue: "POLYMARKET",
          title: "EPL: Chelsea vs Arsenal (Apr 3 7:00PM ET)",
          sourceMetadataVersion: "historical-v1",
          historicalRowCount: 4
        })
      ]
    });

    expect(nonComparable.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.twoPlusVenueOverlapCount).toBe(1);
    expect(nonComparable.overlapMatrix.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.nonComparableOverlapCount).toBe(1);
  });
});
