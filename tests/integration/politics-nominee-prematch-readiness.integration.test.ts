import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee prematch readiness", () => {
  it("stops at readiness when the family is still fragmented", () => {
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({
        interpretedContractId: "op-1",
        venue: "OPINION",
        title: "Who will be the 2028 Democratic nominee for U.S. President?",
        rulesText: "Resolves to the Democratic nominee for President of the United States in 2028."
      }),
      buildLiveNomineeMarket({
        interpretedContractId: "ll-1",
        venue: "LIMITLESS",
        title: "Who will be the 2028 Democratic nominee for Governor of California?",
        rulesText: "Resolves to the Democratic nominee for Governor of California in 2028."
      })
    ]);

    expect(artifacts.prematchReadinessSummary.safeMatcherFollowUpJustified).toBe(false);
    expect(artifacts.candidatePairInputs).toHaveLength(0);
    expect(artifacts.finalDecision.finalLabel).toBe("NOMINEE_BASIS_FRAGMENTATION_CONFIRMED");
  });
});
