import { describe, expect, it } from "vitest";

import {
  buildNomineeWinnerMarket,
  buildOfficeWinnerMarket,
  buildPartyControlMarket,
  runPoliticsArtifacts
} from "./politics-test-fixtures.js";

describe("politics final decision", () => {
  it("can rank politics above sports while keeping politics below crypto rollout priority", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm", venue: "POLYMARKET" }),
      buildPartyControlMarket({ interpretedContractId: "ll", venue: "LIMITLESS" }),
      buildPartyControlMarket({ interpretedContractId: "pd", venue: "PREDICT" }),
      buildNomineeWinnerMarket({ interpretedContractId: "op-n", venue: "OPINION" }),
      buildNomineeWinnerMarket({ interpretedContractId: "pm-n", venue: "POLYMARKET" })
    ]);

    expect(artifacts.finalDecision.sportsComparison).toBe("POLITICS_BEATS_SPORTS_FRONTIER");
    expect(artifacts.finalDecision.cryptoPriority).toBe("POLITICS_BELOW_CRYPTO_PRIORITY");
    expect(artifacts.finalDecision.promisingFamilies).toContain("OFFICE_WINNER");
  });
});
