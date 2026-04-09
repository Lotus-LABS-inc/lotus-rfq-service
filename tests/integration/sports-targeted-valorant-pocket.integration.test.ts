import { describe, expect, it } from "vitest";

import { buildValorantMarket, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-valorant-pocket", () => {
  it("rolls scoped Valorant competitions into the Valorant priority bucket", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildValorantMarket({ interpretedContractId: "val-op", venue: "OPINION", title: "VCT: Sentinels vs Paper Rex (Apr 3 3:00PM ET)" }),
        buildValorantMarket({ interpretedContractId: "val-pm", venue: "POLYMARKET", title: "VALORANT Masters: Paper Rex vs Sentinels (Apr 3 3:00PM ET)" })
      ]
    });

    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|VALORANT"]?.competitionCounts["valorant_vct"]).toBe(1);
    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|VALORANT"]?.competitionCounts["valorant_masters"]).toBe(1);
    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|VALORANT"]?.targetFixtureCount).toBe(2);
    expect(artifacts.overlapMatrix.pockets["ESPORTS|MATCHUP_WINNER|VALORANT"]?.twoPlusVenueOverlapCount).toBe(0);
  });

  it("rejects non-match derivative Valorant rows from the scope", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [
        buildValorantMarket({ interpretedContractId: "val-op", venue: "OPINION" }),
        buildValorantMarket({
          interpretedContractId: "val-derivative",
          venue: "PREDICT",
          title: "VALORANT Champions group winner - Sentinels (Apr 3 3:00PM ET)"
        })
      ]
    });

    expect(artifacts.discoverySummary.pockets["ESPORTS|MATCHUP_WINNER|VALORANT"]?.discoveredRowsByVenue["PREDICT"]).toBe(0);
  });
});
