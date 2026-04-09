import { describe, expect, it } from "vitest";

import { decideBtcTriNextStep } from "../../src/operations/semantic-expansion/btc-tri-next-step-recommendation.js";
import type { VenueBtcCounterpartCapabilityMatrixArtifact } from "../../src/operations/semantic-expansion/venue-btc-counterpart-capability-matrix.js";

const baseCapabilityMatrix = () => ({
  observedAt: new Date().toISOString(),
  metadataVersion: "test",
  opinionBtcBucketCount: 141,
  entries: [
    {
      venue: "LIMITLESS" as const,
      supportedSurfaces: ["detail", "snapshot"],
      marketListCompleteness: "low" as const,
      marketDetailCompleteness: "low" as const,
      searchableByAsset: false,
      searchableByDate: false,
      searchableByContractFamily: false,
      historicalCoverage: "low" as const,
      snapshotCoverage: "low" as const,
      exactCounterpartPresenceProof: "PARTIAL_NEGATIVE_PROOF" as const,
      exactCounterpartAbsenceProof: "CANNOT_PROVE_ABSENCE" as const,
      classification: "POSITIVE_ONLY" as const,
      limitations: [],
      evidenceObserved: {
        available: true,
        candidateCount: 0,
        warningCount: 1
      }
    }
  ]
});

const capabilityMatrixWithPartialNegativeLimitless = (): VenueBtcCounterpartCapabilityMatrixArtifact => {
  const base = baseCapabilityMatrix();
  return {
    ...base,
    entries: [{
      ...base.entries[0]!,
      exactCounterpartAbsenceProof: "PARTIAL_NEGATIVE_PROOF"
    }]
  };
};

const baseProofAudit = () => ({
  observedAt: new Date().toISOString(),
  metadataVersion: "test",
  opinionBtcBucketCount: 141,
  warnings: [],
  classificationCounts: {
    EXISTS_AND_VISIBLE: 0,
    VISIBLE_BUT_NON_EXACT: 0,
    EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE: 0,
    NOT_PROVEN_TO_EXIST: 141,
    PROVEN_NOT_PRESENT: 0
  },
  buckets: []
});

const baseGapSummary = () => ({
  observedAt: new Date().toISOString(),
  metadataVersion: "test",
  opinionBtcBucketCount: 141,
  countsByFamily: [],
  countsByVenueAndClassification: [
    { venue: "POLYMARKET" as const, classification: "INGESTED_BUT_REJECTED" as const, count: 140 },
    { venue: "POLYMARKET" as const, classification: "NOT_FOUND_ON_VENUE" as const, count: 1 },
    { venue: "LIMITLESS" as const, classification: "UNKNOWN" as const, count: 141 }
  ],
  candidateReasonCountsByVenue: [],
  bucketIntersectionSummary: {
    bothVenuesTrulyLackNeededCounterpart: 0,
    oneVenueTrulyLacksNeededCounterpart: 1,
    bothVenuesHaveExactCounterpartOnVenue: 0
  },
  limitlessEvidenceSummary: {
    apiConfirmedExistsButNotIngested: 0,
    snapshotSupportedExistsButNotIngested: 0,
    unknownDueToIncompleteLiveEvidence: 141
  },
  auditOutcomeSummary: {
    bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion: 0,
    bucketsWhereVenueInventoryTrulyDoesNotExist: 1,
    bucketsWhereBothVenuesTrulyLackNeededCounterpart: 0,
    bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap: 0,
    bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion: 1
  },
  dominantRootCauseByVenue: {
    polymarket: "wrong_date_venue_supply" as const,
    limitless: "unknown" as const
  },
  mostPromisingBuckets: []
});

describe("decideBtcTriNextStep", () => {
  it("chooses partner/private access when Limitless remains mostly not proven", () => {
    const result = decideBtcTriNextStep({
      capabilityMatrix: baseCapabilityMatrix(),
      limitlessProofAudit: baseProofAudit(),
      inventoryGapSummary: baseGapSummary()
    });

    expect(result.decision).toBe("LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED");
  });

  it("chooses targeted Limitless ingestion only when exact counterpart existence is proven", () => {
    const result = decideBtcTriNextStep({
      capabilityMatrix: baseCapabilityMatrix(),
      limitlessProofAudit: {
        ...baseProofAudit(),
        classificationCounts: {
          EXISTS_AND_VISIBLE: 2,
          VISIBLE_BUT_NON_EXACT: 0,
          EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE: 0,
          NOT_PROVEN_TO_EXIST: 0,
          PROVEN_NOT_PRESENT: 0
        }
      },
      inventoryGapSummary: {
        ...baseGapSummary(),
        countsByVenueAndClassification: [
          { venue: "LIMITLESS" as const, classification: "EXISTS_BUT_NOT_INGESTED" as const, count: 2 }
        ]
      }
    });

    expect(result.decision).toBe("TARGETED_LIMITLESS_INGESTION_JUSTIFIED");
  });

  it("chooses tri not realistic on public surfaces when PM is wrong-date and Limitless has no visible proof", () => {
    const result = decideBtcTriNextStep({
      capabilityMatrix: {
        ...capabilityMatrixWithPartialNegativeLimitless()
      },
      limitlessProofAudit: baseProofAudit(),
      inventoryGapSummary: {
        ...baseGapSummary(),
        countsByVenueAndClassification: [
          { venue: "POLYMARKET" as const, classification: "INGESTED_BUT_REJECTED" as const, count: 140 }
        ]
      }
    });

    expect(result.decision).toBe("TRI_NOT_CURRENTLY_REALISTIC_ON_PUBLIC_SURFACES");
  });

  it("chooses no more ingestion justified when no exact visibility gap is proven", () => {
    const result = decideBtcTriNextStep({
      capabilityMatrix: {
        ...capabilityMatrixWithPartialNegativeLimitless()
      },
      limitlessProofAudit: {
        ...baseProofAudit(),
        classificationCounts: {
          EXISTS_AND_VISIBLE: 0,
          VISIBLE_BUT_NON_EXACT: 5,
          EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE: 0,
          NOT_PROVEN_TO_EXIST: 10,
          PROVEN_NOT_PRESENT: 126
        }
      },
      inventoryGapSummary: {
        ...baseGapSummary(),
        countsByVenueAndClassification: [],
        auditOutcomeSummary: {
          ...baseGapSummary().auditOutcomeSummary,
          bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap: 0
        }
      }
    });

    expect(result.decision).toBe("NO_MORE_INGESTION_JUSTIFIED");
  });
});
