import type { PairRouteClassId } from "./pair-route-classes.js";

export interface PairCanaryThresholdConfig {
  minimumExactSafeObservations: number;
  minimumFamilyCoverageCount: number;
  minimumConfidenceStability: number;
  minimumCompatibilityStability: number;
  minimumBasisCleanlinessRate: number;
  maximumStaleDataRate: number;
  maximumMixedBasisRate: number;
  maximumOperatorOverrideRate: number;
  maximumPolicyBlockRate: number;
  minimumExpectedNetExecutionImprovement: number;
  maximumExecutionBoundaryIncidentCount: number;
  maximumReplayProtectionIncidentCount: number;
  maximumReconciliationIncidentCount: number;
  maximumVenueHealthFailureRate: number;
}

export const PairCanaryThresholds: Readonly<Record<PairRouteClassId, PairCanaryThresholdConfig>> = {
  PAIR_PM_LIMITLESS: {
    minimumExactSafeObservations: 5,
    minimumFamilyCoverageCount: 2,
    minimumConfidenceStability: 0.9,
    minimumCompatibilityStability: 0.9,
    minimumBasisCleanlinessRate: 0.95,
    maximumStaleDataRate: 0.05,
    maximumMixedBasisRate: 0,
    maximumOperatorOverrideRate: 0.05,
    maximumPolicyBlockRate: 0.1,
    minimumExpectedNetExecutionImprovement: 0.01,
    maximumExecutionBoundaryIncidentCount: 0,
    maximumReplayProtectionIncidentCount: 0,
    maximumReconciliationIncidentCount: 0,
    maximumVenueHealthFailureRate: 0.05
  },
  PAIR_PM_OPINION: {
    minimumExactSafeObservations: 3,
    minimumFamilyCoverageCount: 1,
    minimumConfidenceStability: 0.95,
    minimumCompatibilityStability: 0.95,
    minimumBasisCleanlinessRate: 0.98,
    maximumStaleDataRate: 0.02,
    maximumMixedBasisRate: 0,
    maximumOperatorOverrideRate: 0.02,
    maximumPolicyBlockRate: 0.1,
    minimumExpectedNetExecutionImprovement: 0.005,
    maximumExecutionBoundaryIncidentCount: 0,
    maximumReplayProtectionIncidentCount: 0,
    maximumReconciliationIncidentCount: 0,
    maximumVenueHealthFailureRate: 0.02
  },
  PAIR_PM_PREDICTFUN: {
    minimumExactSafeObservations: 3,
    minimumFamilyCoverageCount: 1,
    minimumConfidenceStability: 0.9,
    minimumCompatibilityStability: 0.9,
    minimumBasisCleanlinessRate: 0.95,
    maximumStaleDataRate: 0.05,
    maximumMixedBasisRate: 0,
    maximumOperatorOverrideRate: 0.05,
    maximumPolicyBlockRate: 0.1,
    minimumExpectedNetExecutionImprovement: 0.005,
    maximumExecutionBoundaryIncidentCount: 0,
    maximumReplayProtectionIncidentCount: 0,
    maximumReconciliationIncidentCount: 0,
    maximumVenueHealthFailureRate: 0.05
  }
} as const;
