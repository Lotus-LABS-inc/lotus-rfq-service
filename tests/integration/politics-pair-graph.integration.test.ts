import { describe, expect, it } from "vitest";

import { buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics pair graph", () => {
  it("builds pair routeability only from exact-safe approved politics edges", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm", venue: "POLYMARKET" }),
      buildOfficeWinnerMarket({ interpretedContractId: "ll", venue: "LIMITLESS" })
    ]);

    expect(artifacts.pairRouteabilitySummary.exactSafePairCountTotal).toBe(3);
    expect(artifacts.pairRouteabilitySummary.bestPoliticsVenuePair).toBeTruthy();
  });
});
