import { describe, expect, it } from "vitest";

import { buildEplMarket, defaultVenueInspection, runSportsTargetedArtifacts } from "./sports-targeted-test-fixtures.js";

describe("sports-targeted-missing-row-classifier", () => {
  it("labels discovery gaps and fetch failures without aborting the pass", async () => {
    const artifacts = await runSportsTargetedArtifacts({
      markets: [buildEplMarket({ interpretedContractId: "epl-op", venue: "OPINION" })],
      venueInspection: defaultVenueInspection.map((entry) =>
        entry.venue === "POLYMARKET"
          ? { ...entry, inspectionMode: "SCOPED_REFRESH_UNAVAILABLE" as const }
          : entry.venue === "LIMITLESS"
            ? { ...entry, fetchStatus: "FAILED" as const }
            : entry
      )
    });

    expect(artifacts.missingVenueSummary.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.missingVenues["POLYMARKET"]?.missingCause).toBe("DISCOVERY_GAP");
    expect(artifacts.missingVenueSummary.pockets["SPORTS|MATCHUP_WINNER|EPL"]?.missingVenues["LIMITLESS"]?.missingCause).toBe("STILL_UNKNOWN");
  });
});
