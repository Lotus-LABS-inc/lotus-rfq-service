import { describe, expect, it } from "vitest";

import { evaluatePairCanaryReadiness } from "../../src/rollout/pair-canary-readiness-evaluator.js";
import type { PairRouteShadowEvidence } from "../../src/shadow/pair-shadow-metrics.js";

const zeroSlice = {
  shadowObservationCount: 0,
  eligibleObservationCount: 0,
  exactSafeObservationCount: 0,
  blockedObservationCount: 0,
  familyCoverageCount: 0,
  canonicalCoverageCount: 0,
  routeChoiceStability: 0,
  confidenceStability: 0,
  compatibilityStability: 0,
  basisCleanlinessRate: 0,
  staleDataRate: 0,
  expectedEdgeVsBaseline: 0,
  expectedNetExecutionImprovement: 0,
  expectedSlippageDelta: 0,
  expectedFillabilityConfidence: 0,
  routeDegradationRate: 0,
  executionBoundaryIncidentCount: 0,
  idempotencyIncidentCount: 0,
  replayProtectionIncidentCount: 0,
  reconciliationIncidentCount: 0,
  operatorOverrideRate: 0,
  policyBlockRate: 0,
  mixedBasisRate: 0,
  insufficientBasisRate: 0,
  insufficientEvidenceRate: 0,
  venueHealthFailureRate: 0,
  routeClassBlockerDistribution: {}
} as const;

const buildEvidence = (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION", countableExactSafeCount: number): PairRouteShadowEvidence => ({
  routeClass,
  routeMode: routeClass === "PAIR_PM_LIMITLESS" ? "POLYMARKET_LIMITLESS" : "POLYMARKET_OPINION",
  currentStage: "SHADOW",
  window: {
    windowStart: "2026-03-30T00:00:00.000Z",
    windowEnd: "2026-03-30T01:00:00.000Z",
    freshnessObservedAt: "2026-03-30T01:00:00.000Z"
  },
  routeOverall: zeroSlice,
  exactSafeSubset: {
    ...zeroSlice,
    exactSafeObservationCount: countableExactSafeCount
  },
  shadowOnlySubset: zeroSlice,
  runtimeOverall: {
    ...zeroSlice,
    shadowObservationCount: countableExactSafeCount
  },
  runtimeExactSafeSubset: {
    ...zeroSlice,
    shadowObservationCount: countableExactSafeCount,
    exactSafeObservationCount: countableExactSafeCount,
    familyCoverageCount: routeClass === "PAIR_PM_LIMITLESS" ? 2 : 1,
    confidenceStability: 1,
    compatibilityStability: 1,
    basisCleanlinessRate: 1,
    expectedNetExecutionImprovement: 0.02
  },
  runtimeShadowOnlySubset: zeroSlice,
  countableRuntimeExactSafeSubset: {
    ...zeroSlice,
    shadowObservationCount: countableExactSafeCount,
    exactSafeObservationCount: countableExactSafeCount,
    familyCoverageCount: routeClass === "PAIR_PM_LIMITLESS" ? 2 : 1,
    confidenceStability: 1,
    compatibilityStability: 1,
    basisCleanlinessRate: 1,
    expectedNetExecutionImprovement: 0.02
  },
  evidenceFresh: true,
  sourceBreakdown: {
    BOOTSTRAP_ARTIFACT: 0,
    RUNTIME_OBSERVATION: countableExactSafeCount
  },
  qualityBreakdown: {
    CANARY_COUNTABLE: countableExactSafeCount,
    SHADOW_ONLY_NOT_COUNTABLE: 0,
    MIXED_BASIS_REJECTED: 0,
    STALE_REJECTED: 0,
    OUT_OF_SCOPE_REJECTED: 0,
    POLICY_BLOCKED: 0
  }
});

describe("pair runtime evidence recount", () => {
  it("uses countable runtime exact-safe observations instead of bootstrap totals for canary readiness", () => {
    const blocked = evaluatePairCanaryReadiness("PAIR_PM_LIMITLESS", buildEvidence("PAIR_PM_LIMITLESS", 4));
    const passed = evaluatePairCanaryReadiness("PAIR_PM_LIMITLESS", buildEvidence("PAIR_PM_LIMITLESS", 5));

    expect(blocked.recommendation).toBe("REMAIN_SHADOW");
    expect(passed.recommendation).toBe("CANARY_APPROVED_PENDING_OPERATOR_ACTION");
  });
});
