import { describe, expect, it } from "vitest";

import { buildPairGraph, listRouteablePairEdges } from "../../src/matching/pair-graph.js";
import type { PairEdgeRecord } from "../../src/matching/matching-types.js";

const buildEdge = (overrides: Partial<PairEdgeRecord>): PairEdgeRecord => ({
  id: "edge-1",
  canonicalEventId: "11111111-1111-5111-8111-111111111111",
  interpretedContractAId: "a",
  interpretedContractBId: "b",
  leftVenue: "POLYMARKET",
  rightVenue: "LIMITLESS",
  family: "THRESHOLD_BY_DATE",
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
    replay: {
      replayReference: null,
      deterministicInputHash: "hash",
      evaluationVersion: "ver-1"
    }
  },
  computedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
  ...overrides
});

describe("pair graph", () => {
  it("includes only approved exact edges as routeable", () => {
    const graph = buildPairGraph([
      buildEdge({ id: "edge-exact" }),
      buildEdge({ id: "edge-equiv", label: "EQUIVALENT", approvalState: "pendingReview", interpretedContractBId: "c" })
    ]);

    const routeable = listRouteablePairEdges(graph);
    expect(routeable).toHaveLength(1);
    expect(routeable[0]?.id).toBe("edge-exact");
  });
});
