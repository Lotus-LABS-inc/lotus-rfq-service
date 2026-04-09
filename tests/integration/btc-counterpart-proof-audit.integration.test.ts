import { describe, expect, it } from "vitest";

import { buildBtcLimitlessCounterpartProofAuditFromInputs } from "../../src/operations/semantic-expansion/btc-limitless-counterpart-proof-audit.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

describe("btc counterpart proof audit integration shape", () => {
  it("keeps unknown buckets explicit when Limitless surfaces cannot prove the universe", () => {
    const result = buildBtcLimitlessCounterpartProofAuditFromInputs({
      matrix: {
        summary: {
          observedAt: new Date().toISOString(),
          metadataVersion: "test",
          scannedCryptoMarketCount: 2,
          countsByFamily: {
            ATH_BY_DATE: 0,
            THRESHOLD_BY_DATE: 0,
            SAME_DAY_DIRECTIONAL: 2,
            PRICE_AT_CLOSE: 0,
            GENERIC_UP_DOWN: 0
          },
          btcTargetableDates: [],
          matrix: []
        },
        rows: [
          {
            marketId: "10045",
            title: "Bitcoin Up or Down on March 22?(12:00 ET)",
            asset: "bitcoin",
            family: "SAME_DAY_DIRECTIONAL",
            exactDate: "march 22 2026",
            cutoffStyle: "NOON_ET_DAILY",
            triggerStyle: "directional_yes_no"
          },
          {
            marketId: "10046",
            title: "Bitcoin Up or Down on March 23?(12:00 ET)",
            asset: "bitcoin",
            family: "SAME_DAY_DIRECTIONAL",
            exactDate: "march 23 2026",
            cutoffStyle: "NOON_ET_DAILY",
            triggerStyle: "directional_yes_no"
          }
        ]
      },
      limitlessUniverse: {
        available: true,
        exactAbsenceAllowed: false,
        warnings: ["limitless_live_audit_has_no_positive_candidates"],
        candidates: [{
          venue: "LIMITLESS",
          venueMarketId: "visible-wrong-date",
          title: "Bitcoin Up or Down on March 21?(12:00 ET)",
          rules: null,
          family: "SAME_DAY_DIRECTIONAL",
          asset: "bitcoin",
          exactDate: "march 21 2026",
          cutoffStyle: "NOON_ET_DAILY",
          parsed: parseStructuredProposition({
            category: "CRYPTO",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)",
            rules: null
          }),
          evidenceProvenance: "api_confirmed",
          reference: "slug-1"
        }]
      }
    });

    expect(result.audit.classificationCounts.VISIBLE_BUT_NON_EXACT).toBe(2);
    expect(result.markdown).toContain("cannot be proven");
  });
});
