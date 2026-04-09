import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee fragmentation", () => {
  it("classifies party-basis fragmentation explicitly", () => {
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({
        interpretedContractId: "op-1",
        venue: "OPINION",
        title: "Who will be the 2028 Democratic nominee for U.S. President?",
        rulesText: "Resolves to the Democratic nominee for President of the United States in 2028."
      }),
      buildLiveNomineeMarket({
        interpretedContractId: "pm-1",
        venue: "POLYMARKET",
        title: "Who will be the 2028 Republican nominee for U.S. President?",
        rulesText: "Resolves to the Republican nominee for President of the United States in 2028."
      })
    ]);

    expect(artifacts.basisFragmentationSummary.labels.PARTY_BASIS_FRAGMENTED).toBe(1);
  });
});
