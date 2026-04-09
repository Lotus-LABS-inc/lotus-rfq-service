import { describe, expect, it } from "vitest";

import { buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics structural fingerprint", () => {
  it("keeps same candidate names distinct when office or cycle differs", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({
        interpretedContractId: "pres-op",
        venue: "OPINION",
        candidate: "Gavin Newsom",
        title: "Will Gavin Newsom win the 2028 U.S. presidential election?"
      }),
      buildOfficeWinnerMarket({
        interpretedContractId: "gov-pm",
        venue: "POLYMARKET",
        candidate: "Gavin Newsom",
        title: "Will Gavin Newsom win the 2026 California governor election?"
      })
    ]);

    expect(artifacts.structuralFingerprintSamples[0]?.candidateSetFingerprint).toContain("gavin newsom");
    expect(artifacts.prefilterRejectionBreakdown.CYCLE_MISMATCH ?? 0).toBeGreaterThanOrEqual(1);
  });
});
