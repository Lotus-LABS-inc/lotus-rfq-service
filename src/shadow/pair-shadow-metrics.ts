export interface PairShadowMetricSlice {
  shadowObservationCount: number;
  eligibleObservationCount: number;
  exactSafeObservationCount: number;
  blockedObservationCount: number;
  familyCoverageCount: number;
  canonicalCoverageCount: number;
  routeChoiceStability: number;
  confidenceStability: number;
  compatibilityStability: number;
  basisCleanlinessRate: number;
  staleDataRate: number;
  expectedEdgeVsBaseline: number;
  expectedNetExecutionImprovement: number;
  expectedSlippageDelta: number;
  expectedFillabilityConfidence: number;
  routeDegradationRate: number;
  executionBoundaryIncidentCount: number;
  idempotencyIncidentCount: number;
  replayProtectionIncidentCount: number;
  reconciliationIncidentCount: number;
  operatorOverrideRate: number;
  policyBlockRate: number;
  mixedBasisRate: number;
  insufficientBasisRate: number;
  insufficientEvidenceRate: number;
  venueHealthFailureRate: number;
  routeClassBlockerDistribution: Record<string, number>;
}

export interface PairShadowMetricsWindow {
  windowStart: string;
  windowEnd: string;
  freshnessObservedAt: string;
}

export interface PairRouteShadowEvidence {
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION";
  routeMode: "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION";
  currentStage: string;
  window: PairShadowMetricsWindow;
  routeOverall: PairShadowMetricSlice;
  exactSafeSubset: PairShadowMetricSlice;
  shadowOnlySubset: PairShadowMetricSlice;
  runtimeOverall: PairShadowMetricSlice;
  runtimeExactSafeSubset: PairShadowMetricSlice;
  runtimeShadowOnlySubset: PairShadowMetricSlice;
  countableRuntimeExactSafeSubset: PairShadowMetricSlice;
  evidenceFresh: boolean;
  sourceBreakdown: Record<"BOOTSTRAP_ARTIFACT" | "RUNTIME_OBSERVATION", number>;
  qualityBreakdown: Record<
    | "CANARY_COUNTABLE"
    | "SHADOW_ONLY_NOT_COUNTABLE"
    | "MIXED_BASIS_REJECTED"
    | "STALE_REJECTED"
    | "OUT_OF_SCOPE_REJECTED"
    | "POLICY_BLOCKED",
    number
  >;
}
