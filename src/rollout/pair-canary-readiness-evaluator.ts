import type { PairRouteShadowEvidence } from "../shadow/pair-shadow-metrics.js";
import type { PairRouteClassId } from "./pair-route-classes.js";
import { PairCanaryThresholds, type PairCanaryThresholdConfig } from "./pair-canary-thresholds.js";

export type PairCanaryRecommendation =
  | "REMAIN_SHADOW"
  | "READY_FOR_CANARY_REVIEW"
  | "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
  | "BLOCKED";

export interface PairCanaryThresholdResult {
  metric: string;
  pass: boolean;
  actual: number;
  threshold: number;
  comparator: ">=" | "<=" | "==";
}

export interface PairCanaryReadiness {
  routeClass: PairRouteClassId;
  thresholds: PairCanaryThresholdConfig;
  thresholdResults: readonly PairCanaryThresholdResult[];
  blockerReasons: readonly string[];
  recommendation: PairCanaryRecommendation;
}

const checkMin = (metric: string, actual: number, threshold: number): PairCanaryThresholdResult => ({
  metric,
  pass: actual >= threshold,
  actual,
  threshold,
  comparator: ">="
});

const checkMax = (metric: string, actual: number, threshold: number): PairCanaryThresholdResult => ({
  metric,
  pass: actual <= threshold,
  actual,
  threshold,
  comparator: "<="
});

export const evaluatePairCanaryReadiness = (
  routeClass: PairRouteClassId,
  evidence: PairRouteShadowEvidence
): PairCanaryReadiness => {
  const thresholds = PairCanaryThresholds[routeClass];
  const scope = evidence.countableRuntimeExactSafeSubset;
  const thresholdResults: PairCanaryThresholdResult[] = [
    checkMin("minimumExactSafeObservations", scope.exactSafeObservationCount, thresholds.minimumExactSafeObservations),
    checkMin("minimumFamilyCoverageCount", scope.familyCoverageCount, thresholds.minimumFamilyCoverageCount),
    checkMin("minimumConfidenceStability", scope.confidenceStability, thresholds.minimumConfidenceStability),
    checkMin("minimumCompatibilityStability", scope.compatibilityStability, thresholds.minimumCompatibilityStability),
    checkMin("minimumBasisCleanlinessRate", scope.basisCleanlinessRate, thresholds.minimumBasisCleanlinessRate),
    checkMax("maximumStaleDataRate", scope.staleDataRate, thresholds.maximumStaleDataRate),
    checkMax("maximumMixedBasisRate", scope.mixedBasisRate, thresholds.maximumMixedBasisRate),
    checkMax("maximumOperatorOverrideRate", scope.operatorOverrideRate, thresholds.maximumOperatorOverrideRate),
    checkMax("maximumPolicyBlockRate", scope.policyBlockRate, thresholds.maximumPolicyBlockRate),
    checkMin("minimumExpectedNetExecutionImprovement", scope.expectedNetExecutionImprovement, thresholds.minimumExpectedNetExecutionImprovement),
    checkMax("maximumExecutionBoundaryIncidentCount", scope.executionBoundaryIncidentCount, thresholds.maximumExecutionBoundaryIncidentCount),
    checkMax("maximumReplayProtectionIncidentCount", scope.replayProtectionIncidentCount, thresholds.maximumReplayProtectionIncidentCount),
    checkMax("maximumReconciliationIncidentCount", scope.reconciliationIncidentCount, thresholds.maximumReconciliationIncidentCount),
    checkMax("maximumVenueHealthFailureRate", scope.venueHealthFailureRate, thresholds.maximumVenueHealthFailureRate)
  ];

  const blockerReasons = thresholdResults.filter((entry) => !entry.pass).map((entry) => entry.metric);
  let recommendation: PairCanaryRecommendation = "REMAIN_SHADOW";
  if (scope.shadowObservationCount === 0 || scope.exactSafeObservationCount === 0) {
    recommendation = "REMAIN_SHADOW";
  } else if (blockerReasons.length === 0 && evidence.qualityBreakdown.CANARY_COUNTABLE > 0) {
    recommendation = "CANARY_APPROVED_PENDING_OPERATOR_ACTION";
  } else if (blockerReasons.length === 0) {
    recommendation = "READY_FOR_CANARY_REVIEW";
  } else if (scope.executionBoundaryIncidentCount > 0 || scope.replayProtectionIncidentCount > 0 || scope.reconciliationIncidentCount > 0) {
    recommendation = "BLOCKED";
  }

  return {
    routeClass,
    thresholds,
    thresholdResults,
    blockerReasons,
    recommendation
  };
};
