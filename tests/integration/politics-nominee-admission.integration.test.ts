import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee admission", () => {
  it("admits only strict nominee rows", () => {
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({ interpretedContractId: "op-1", venue: "OPINION" }),
      buildLiveNomineeMarket({
        interpretedContractId: "op-2",
        venue: "OPINION",
        title: "Who will win the 2028 Democratic primary for U.S. President?",
        rulesText: "Resolves to the winner of the Democratic primary contest."
      })
    ]);

    expect(artifacts.admissionSummary.admittedCount).toBe(1);
    expect(artifacts.admissionSummary.labels.NOMINEE_ADMITTED).toBe(1);
    expect(artifacts.admissionSummary.labels.PRIMARY_WINNER_NOT_NOMINEE).toBe(1);
  });
});
