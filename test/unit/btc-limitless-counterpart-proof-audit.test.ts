import { describe, expect, it } from "vitest";

import {
  buildBtcLimitlessCounterpartProofAuditFromInputs,
  classifyLimitlessBucketProof
} from "../../src/operations/semantic-expansion/btc-limitless-counterpart-proof-audit.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

const buildBucket = (title: string, exactDate = "march 22 2026") => ({
  marketId: "10045",
  title,
  asset: "bitcoin",
  family: "SAME_DAY_DIRECTIONAL" as const,
  exactDate,
  cutoffStyle: "NOON_ET_DAILY" as const,
  triggerStyle: "directional_yes_no"
});

const buildCandidate = (input: {
  title: string;
  family: string;
  exactDate: string | null;
  cutoffStyle: "NOON_ET_DAILY" | "END_OF_DAY_BY_DATE" | "UNKNOWN";
  evidenceProvenance: "api_confirmed" | "snapshot_supported";
}) => ({
  venue: "LIMITLESS" as const,
  venueMarketId: input.title,
  title: input.title,
  rules: null,
  family: input.family,
  asset: "bitcoin",
  exactDate: input.exactDate,
  cutoffStyle: input.cutoffStyle,
  parsed: parseStructuredProposition({
    category: "CRYPTO",
    title: input.title,
    rules: null
  }),
  evidenceProvenance: input.evidenceProvenance,
  reference: "ref-1"
});

describe("classifyLimitlessBucketProof", () => {
  it("returns EXISTS_AND_VISIBLE for api-confirmed exact counterparts", () => {
    const result = classifyLimitlessBucketProof({
      bucket: buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)"),
      universe: {
        available: true,
        exactAbsenceAllowed: false,
        warnings: [],
        candidates: [buildCandidate({
          title: "Bitcoin Up or Down on March 22?(12:00 ET)",
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 22 2026",
          cutoffStyle: "NOON_ET_DAILY",
          evidenceProvenance: "api_confirmed"
        })]
      }
    });

    expect(result.classification).toBe("EXISTS_AND_VISIBLE");
  });

  it("returns VISIBLE_BUT_NON_EXACT for same-family wrong-date candidates", () => {
    const result = classifyLimitlessBucketProof({
      bucket: buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)"),
      universe: {
        available: true,
        exactAbsenceAllowed: false,
        warnings: [],
        candidates: [buildCandidate({
          title: "Bitcoin Up or Down on March 21?(12:00 ET)",
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 21 2026",
          cutoffStyle: "NOON_ET_DAILY",
          evidenceProvenance: "api_confirmed"
        })]
      }
    });

    expect(result.classification).toBe("VISIBLE_BUT_NON_EXACT");
  });

  it("returns EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE for exact snapshot-only proof", () => {
    const result = classifyLimitlessBucketProof({
      bucket: buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)"),
      universe: {
        available: true,
        exactAbsenceAllowed: false,
        warnings: [],
        candidates: [buildCandidate({
          title: "Bitcoin Up or Down on March 22?(12:00 ET)",
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 22 2026",
          cutoffStyle: "NOON_ET_DAILY",
          evidenceProvenance: "snapshot_supported"
        })]
      }
    });

    expect(result.classification).toBe("EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE");
  });

  it("returns NOT_PROVEN_TO_EXIST when current surfaces cannot prove presence or absence", () => {
    const result = classifyLimitlessBucketProof({
      bucket: buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)"),
      universe: {
        available: false,
        exactAbsenceAllowed: false,
        warnings: [],
        candidates: []
      }
    });

    expect(result.classification).toBe("NOT_PROVEN_TO_EXIST");
  });

  it("returns PROVEN_NOT_PRESENT only when exact absence is explicitly allowed", () => {
    const result = classifyLimitlessBucketProof({
      bucket: buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)"),
      universe: {
        available: true,
        exactAbsenceAllowed: true,
        warnings: [],
        candidates: []
      }
    });

    expect(result.classification).toBe("PROVEN_NOT_PRESENT");
  });

  it("aggregates classification counts in the audit summary", () => {
    const result = buildBtcLimitlessCounterpartProofAuditFromInputs({
      matrix: {
        summary: {
          observedAt: new Date().toISOString(),
          metadataVersion: "test",
          scannedCryptoMarketCount: 1,
          countsByFamily: {
            ATH_BY_DATE: 0,
            THRESHOLD_BY_DATE: 0,
            SAME_DAY_DIRECTIONAL: 1,
            PRICE_AT_CLOSE: 0,
            GENERIC_UP_DOWN: 0
          },
          btcTargetableDates: [],
          matrix: []
        },
        rows: [buildBucket("Bitcoin Up or Down on March 22?(12:00 ET)")]
      },
      limitlessUniverse: {
        available: true,
        exactAbsenceAllowed: false,
        warnings: [],
        candidates: [buildCandidate({
          title: "Bitcoin Up or Down on March 21?(12:00 ET)",
          family: "SAME_DAY_DIRECTIONAL",
          exactDate: "march 21 2026",
          cutoffStyle: "NOON_ET_DAILY",
          evidenceProvenance: "api_confirmed"
        })]
      }
    });

    expect(result.audit.classificationCounts.VISIBLE_BUT_NON_EXACT).toBe(1);
  });
});
