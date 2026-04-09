import { describe, expect, it } from "vitest";

import { buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics structural matcher", () => {
  it("approves exact-safe edges only for structurally identical politics rows", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm", venue: "POLYMARKET" }),
      buildOfficeWinnerMarket({
        interpretedContractId: "pd",
        venue: "PREDICT",
        title: "Will Gavin Newsom win the 2032 U.S. presidential election?"
      })
    ]);

    expect(artifacts.matchQualitySummary.exactSafeApprovedCount).toBe(1);
    expect(artifacts.pairRouteabilitySummary.exactSafePairCountByFamily.POLITICS_OFFICE_WINNER).toBe(1);
  });
});
