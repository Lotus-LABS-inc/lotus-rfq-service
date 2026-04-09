import { describe, expect, it } from "vitest";

import { deriveTriCandidates } from "../../src/matching/tri-deriver.js";
import type { PairEdgeRecord } from "../../src/matching/matching-types.js";

const baseEdge = (id: string, a: string, b: string): PairEdgeRecord => ({
  id,
  canonicalEventId: "11111111-1111-5111-8111-111111111111",
  interpretedContractAId: a,
  interpretedContractBId: b,
  leftVenue: "POLYMARKET",
  rightVenue: "LIMITLESS",
  family: "ATH_BY_DATE",
  label: "EXACT",
  confidenceScore: "1",
  approvalState: "autoApproved",
  reasons: [],
  rejectionReasons: [],
  temporalBasis: "LIVE_ONLY",
  compatibilityDecisionId: null,
  compatibilityClass: null,
  matchingVersionId: "ver-1",
  provenance: {
    familyClassifierRuleIds: [],
    fingerprintRuleIds: [],
    prefilterRuleIds: [],
    structuralRuleIds: [],
    classifierRuleIds: [],
    embeddingRuleIds: [],
    temporalBasis: "LIVE_ONLY",
    replay: { replayReference: null, deterministicInputHash: "hash", evaluationVersion: "ver-1" }
  },
  computedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null
});

describe("tri deriver", () => {
  it("derives tri only from exact approved pair edges", () => {
    const triCandidates = deriveTriCandidates([
      baseEdge("ab", "a", "b"),
      baseEdge("ac", "a", "c"),
      baseEdge("bc", "b", "c")
    ]);

    expect(triCandidates[0]?.exactSafe).toBe(true);
    expect(triCandidates[0]?.blockerReasons).toHaveLength(0);
  });
});
