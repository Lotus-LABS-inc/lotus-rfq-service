import { describe, expect, it } from "vitest";

import { buildLiveNomineeMarket, runPoliticsNomineeArtifacts } from "./politics-test-fixtures.js";

describe("politics nominee basis normalization", () => {
  it("normalizes office jurisdiction cycle and party basis", () => {
    const artifacts = runPoliticsNomineeArtifacts([
      buildLiveNomineeMarket({
        interpretedContractId: "op-1",
        venue: "OPINION",
        title: "Who will be the 2028 Democratic nominee for U.S. President?",
        rulesText: "Resolves to the Democratic nominee for President of the United States in 2028."
      })
    ]);

    const normalized = artifacts.admittedRows[0]?.normalized;
    expect(normalized?.office).toBe("president");
    expect(normalized?.jurisdiction).toBe("usa");
    expect(normalized?.cycleYear).toBe("2028");
    expect(normalized?.nominatingBody).toBe("democratic");
    expect(normalized?.wordingType).toBe("WHO_WILL_BE_NOMINEE");
  });
});
