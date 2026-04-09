import { describe, expect, it } from "vitest";

import { buildPoliticsCurrentStateFairnessSummary } from "../../src/reports/politics-current-state-refresh.js";

describe("politics current-state refresh fairness decision", () => {
  it("marks refresh usable without overclaiming matcher readiness", () => {
    const result = buildPoliticsCurrentStateFairnessSummary({
      fetchStatuses: {
        POLYMARKET: "SUCCESS",
        OPINION: "SUCCESS",
        LIMITLESS: "EMPTY",
        PREDICT: "UNAVAILABLE"
      },
      refreshedRowsByVenue: {
        POLYMARKET: 2,
        OPINION: 1
      },
      nomineeAdmittedRows: 1,
      nomineeComparableClusters: 0,
      nomineeEligibility: "BASIS_FRAGMENTED"
    });

    expect(result.fairnessSummary.primaryDecision).toBe("POLITICS_REFRESH_PARTIAL_BUT_USABLE");
    expect(result.finalDecision.matcherFollowUpJustified).toBe(false);
  });
});
