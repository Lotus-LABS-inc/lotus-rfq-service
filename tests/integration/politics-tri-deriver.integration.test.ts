import { describe, expect, it } from "vitest";

import { buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics tri deriver", () => {
  it("only derives tri when all three exact-safe pair edges exist", async () => {
    const triArtifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm", venue: "POLYMARKET" }),
      buildOfficeWinnerMarket({ interpretedContractId: "ll", venue: "LIMITLESS" })
    ]);
    const blockedArtifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op2", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm2", venue: "POLYMARKET" }),
      buildOfficeWinnerMarket({
        interpretedContractId: "ll2",
        venue: "LIMITLESS",
        title: "Will Gavin Newsom win the 2032 U.S. presidential election?"
      })
    ]);

    expect(triArtifacts.triRouteabilitySummary.triExactSafeCount).toBeGreaterThanOrEqual(1);
    expect(blockedArtifacts.triRouteabilitySummary.dominantTriBlocker).toBeTruthy();
  });
});
