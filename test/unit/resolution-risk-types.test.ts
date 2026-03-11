import { describe, expect, it } from "vitest";
import type {
  NormalizedResolutionProfile,
  ResolutionEquivalenceClass,
  ResolutionRiskAssessment
} from "../../src/core/rfq-engine/resolution-risk.types.js";

describe("resolution risk canonical domain types", () => {
  it("keeps persisted numeric fields string-backed", () => {
    const profile: NormalizedResolutionProfile = {
      id: "eb7d2b6d-160c-4aef-9947-5f1ace6525d7",
      venue: "venue-a",
      venueMarketId: "market-123",
      canonicalEventId: "e8bc7dde-ccf5-41d3-9a10-06ca40c0eb6a",
      disputeWindowHours: "24",
      settlementLagHours: "12",
      historicalDivergenceRate: "0.02500000",
      hasAmbiguousTimeBoundary: false,
      hasAmbiguousJurisdictionBoundary: true,
      hasAmbiguousSourceReference: false,
      metadata: {},
      createdAt: new Date("2026-03-11T08:00:00.000Z"),
      updatedAt: new Date("2026-03-11T08:00:00.000Z")
    };

    const assessment: ResolutionRiskAssessment = {
      id: "4d55f655-1adb-4afc-bd90-bec9288ed97e",
      canonicalEventId: profile.canonicalEventId,
      marketAProfileId: profile.id,
      marketBProfileId: "672f845b-a318-4f07-a0c7-dd9f39b59117",
      riskScore: "0.35000000",
      confidenceScore: "0.90000000",
      equivalenceClass: "HIGH_RISK",
      factorBreakdown: { disputeWindowMismatch: "material" },
      reasons: ["different_dispute_window"],
      version: "v1",
      computedAt: new Date("2026-03-11T08:05:00.000Z")
    };

    expect(typeof profile.disputeWindowHours).toBe("string");
    expect(typeof profile.settlementLagHours).toBe("string");
    expect(typeof profile.historicalDivergenceRate).toBe("string");
    expect(typeof assessment.riskScore).toBe("string");
    expect(typeof assessment.confidenceScore).toBe("string");
  });

  it("keeps factor breakdown structured and reasons as string array", () => {
    const assessment: ResolutionRiskAssessment = {
      id: "3b4b7156-f330-4b45-b143-f33bc027607f",
      canonicalEventId: "10a8e013-cf34-4f72-aef4-c84fb386a59f",
      marketAProfileId: "6df5db75-4ce4-41f4-9770-947f3da684dd",
      marketBProfileId: "7a5c9900-3867-4f1f-bec1-39d4b33f59a5",
      riskScore: "0.10000000",
      confidenceScore: "0.98000000",
      equivalenceClass: "SAFE_EQUIVALENT",
      factorBreakdown: {
        authority: "same",
        oracle: "same"
      },
      reasons: ["matching_authority", "matching_oracle"],
      version: "v1",
      computedAt: new Date("2026-03-11T08:10:00.000Z")
    };

    expect(assessment.factorBreakdown).toHaveProperty("authority", "same");
    expect(assessment.reasons).toEqual(["matching_authority", "matching_oracle"]);
  });

  it("exposes the v1 equivalence classes", () => {
    const equivalent: ResolutionEquivalenceClass = "SAFE_EQUIVALENT";
    const caution: ResolutionEquivalenceClass = "CAUTION";
    const highRisk: ResolutionEquivalenceClass = "HIGH_RISK";
    const doNotPool: ResolutionEquivalenceClass = "DO_NOT_POOL";

    expect([
      equivalent,
      caution,
      highRisk,
      doNotPool
    ]).toEqual([
      "SAFE_EQUIVALENT",
      "CAUTION",
      "HIGH_RISK",
      "DO_NOT_POOL"
    ]);
  });
});
