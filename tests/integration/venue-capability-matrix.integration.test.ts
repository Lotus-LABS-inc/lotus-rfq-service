import { describe, expect, it } from "vitest";

import { buildVenueBtcCounterpartCapabilityMatrixFromInputs } from "../../src/operations/semantic-expansion/venue-btc-counterpart-capability-matrix.js";

describe("venue capability matrix integration shape", () => {
  it("makes Limitless surface limitations explicit in the markdown summary", () => {
    const result = buildVenueBtcCounterpartCapabilityMatrixFromInputs({
      opinionBtcBucketCount: 141,
      polymarketUniverse: {
        available: true,
        exactAbsenceAllowed: true,
        candidates: [],
        warnings: []
      },
      limitlessUniverse: {
        available: false,
        exactAbsenceAllowed: false,
        candidates: [],
        warnings: ["limitless_live_api_unavailable_and_no_snapshot_positive_evidence"]
      }
    });

    expect(result.markdown).toContain("Limitless");
    expect(result.markdown).toContain("CANNOT_PROVE_ABSENCE");
  });
});
