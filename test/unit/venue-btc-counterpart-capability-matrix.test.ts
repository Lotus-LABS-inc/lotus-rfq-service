import { describe, expect, it } from "vitest";

import { buildVenueBtcCounterpartCapabilityMatrixFromInputs } from "../../src/operations/semantic-expansion/venue-btc-counterpart-capability-matrix.js";

describe("buildVenueBtcCounterpartCapabilityMatrixFromInputs", () => {
  it("marks Limitless as positive-only when only partial public evidence exists", () => {
    const result = buildVenueBtcCounterpartCapabilityMatrixFromInputs({
      opinionBtcBucketCount: 141,
      polymarketUniverse: {
        available: true,
        exactAbsenceAllowed: true,
        candidates: [],
        warnings: []
      },
      limitlessUniverse: {
        available: true,
        exactAbsenceAllowed: false,
        candidates: [],
        warnings: ["limitless_live_audit_has_no_positive_candidates"]
      }
    });

    const limitless = result.matrix.entries.find((entry) => entry.venue === "LIMITLESS");
    expect(limitless?.classification).toBe("POSITIVE_ONLY");
    expect(limitless?.exactCounterpartAbsenceProof).toBe("CANNOT_PROVE_ABSENCE");
  });
});
