import { describe, expect, it } from "vitest";

import { buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics candidate prefilter", () => {
  it("fails closed on unknown critical fields and jurisdiction mismatches", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({
        interpretedContractId: "op-1",
        venue: "OPINION",
        title: "Will Gavin Newsom win the 2028 U.S. presidential election?"
      }),
      buildOfficeWinnerMarket({
        interpretedContractId: "pm-1",
        venue: "POLYMARKET",
        title: "Will Gavin Newsom win the 2028 French presidential election?",
        rulesText: "Resolves yes if Gavin Newsom wins the 2028 French presidential election."
      }),
      buildOfficeWinnerMarket({
        interpretedContractId: "ll-1",
        venue: "LIMITLESS",
        title: "Will someone win the presidential election?",
        rulesText: "Resolves yes if someone wins the presidential election."
      })
    ]);

    expect(artifacts.prefilterRejectionBreakdown.JURISDICTION_MISMATCH ?? 0).toBeGreaterThanOrEqual(1);
    expect(artifacts.prefilterRejectionBreakdown.UNKNOWN_CRITICAL_FIELD ?? 0).toBeGreaterThanOrEqual(1);
  });
});
