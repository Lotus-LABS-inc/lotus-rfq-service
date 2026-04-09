import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee eligibility", () => {
  it("upgrades to matching eligible when a real exact subgroup recurs across venues", () => {
    const title = "Who will be the 2028 Democratic nominee for U.S. President?";
    const rules = "Resolves to the Democratic nominee for President of the United States in 2028.";
    const outcomes = [{ label: "Gavin Newsom" }, { label: "Pete Buttigieg" }, { label: "Other" }] as const;
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({ interpretedContractId: "op-1", venue: "OPINION", title, rulesText: rules, outcomes }),
      buildLiveNomineeMarket({ interpretedContractId: "pm-1", venue: "POLYMARKET", title, rulesText: rules, outcomes })
    ]);

    expect(artifacts.eligibilityDecision.state).toBe("MATCHING_ELIGIBLE");
    expect(artifacts.finalDecision.finalLabel).toBe("NOMINEE_MATCHING_ELIGIBLE_READY_FOR_MATCHER");
  });
});
