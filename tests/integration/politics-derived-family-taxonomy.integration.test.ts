import { describe, expect, it } from "vitest";

import {
  buildConfirmationMarket,
  buildNomineeWinnerMarket,
  buildOfficeExitMarket,
  buildOfficeWinnerMarket,
  buildPartyControlMarket,
  runPoliticsArtifacts
} from "./politics-test-fixtures.js";

describe("politics derived family taxonomy", () => {
  it("separates core politics families and marks confirmation rows as needing a split", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "office-op", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "office-pm", venue: "POLYMARKET" }),
      buildPartyControlMarket({ interpretedContractId: "party-op", venue: "OPINION" }),
      buildPartyControlMarket({ interpretedContractId: "party-ll", venue: "LIMITLESS" }),
      buildNomineeWinnerMarket({ interpretedContractId: "nom-op", venue: "OPINION" }),
      buildNomineeWinnerMarket({ interpretedContractId: "nom-pd", venue: "PREDICT" }),
      buildConfirmationMarket({ interpretedContractId: "conf-op", venue: "OPINION" }),
      buildConfirmationMarket({ interpretedContractId: "conf-pm", venue: "POLYMARKET" }),
      buildOfficeExitMarket({ interpretedContractId: "exit-op", venue: "OPINION" })
    ]);

    expect(artifacts.familyEligibilitySummary.OFFICE_WINNER?.eligibility).toBe("MATCHING_ELIGIBLE");
    expect(artifacts.familyEligibilitySummary.PARTY_CONTROL?.eligibility).toBe("MATCHING_ELIGIBLE");
    expect(artifacts.familyEligibilitySummary.NOMINEE_WINNER?.eligibility).toBe("MATCHING_ELIGIBLE");
    expect(artifacts.familyEligibilitySummary.CONFIRMATION_APPOINTMENT?.eligibility).toBe("ELIGIBLE_AFTER_SPLIT");
    expect(artifacts.familyEligibilitySummary.OFFICE_EXIT_BY_DATE?.eligibility).toBe("TOO_THIN");
  });
});
