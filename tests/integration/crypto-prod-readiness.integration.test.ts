import { describe, expect, it } from "vitest";

import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { buildCryptoProdArtifacts } from "../../src/operations/semantic-expansion/crypto-prod-readiness.js";
import type { PairCanaryReadiness } from "../../src/rollout/pair-canary-readiness-evaluator.js";
import { getPairRouteClassDefinition } from "../../src/rollout/pair-route-classes.js";
import type { PairRouteQualification } from "../../src/qualification/pair-route-qualification.js";
import type { PairRouteShadowEvidence, PairShadowMetricSlice } from "../../src/shadow/pair-shadow-metrics.js";

const buildRoute = (input: {
  routeClassId: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  canaryAllowedFamilies: readonly string[];
  blockedFamilies?: readonly string[];
  currentStage?: QualificationStage;
  readinessState?: PairRouteQualification["readinessState"];
}): PairRouteQualification => ({
  routeClassId: input.routeClassId,
  definition: {
    ...getPairRouteClassDefinition(input.routeClassId),
    allowedCategories: ["CRYPTO"],
    shadowAllowedFamilies: input.canaryAllowedFamilies,
    canaryAllowedFamilies: input.canaryAllowedFamilies,
    blockedFamilies: [...(input.blockedFamilies ?? [])]
  },
  currentStage: input.currentStage ?? QualificationStage.SHADOW,
  readinessState: input.readinessState ?? "CANARY_READY",
  recommendation: "CANARY",
  blockedFamilies: [...(input.blockedFamilies ?? [])],
  historicalQualification: {
    routeableMarketCount: 1,
    eventCount: 1,
    exactHistoricalQualifiedCount: 1,
    basisClean: true
  },
  liveQualification: {
    routeableMarketCount: 1,
    eventCount: 1,
    exactLiveOnlyCount: 1,
    basisClean: true
  },
  mixedBasisDiagnostic: {
    routeableMarketCount: 0,
    eventCount: 0
  },
  exactNearExactDistribution: {
    exactHistoricalQualifiedCount: 1,
    exactLiveOnlyCount: 1,
    nearExactCount: 0,
    noCandidateCount: 0
  },
  safeSubsetMarkets: [],
  runnableMarkets: [],
  riskProfile: {
    basisCleanliness: "HISTORICAL_STRONG",
    dominantBlockers: [],
    compatibilityQuality: "HIGH",
    provenanceQuality: "HIGH",
    operationalConcerns: [],
    summary: "test-ready",
    recommendedReadinessCap: input.readinessState ?? "CANARY_READY"
  },
  supportedFamilies: [...input.canaryAllowedFamilies],
  evidenceRefs: []
});

const buildMetricSlice = (): PairShadowMetricSlice => ({
  shadowObservationCount: 10,
  eligibleObservationCount: 10,
  exactSafeObservationCount: 10,
  blockedObservationCount: 0,
  familyCoverageCount: 2,
  canonicalCoverageCount: 2,
  routeChoiceStability: 1,
  confidenceStability: 1,
  compatibilityStability: 1,
  basisCleanlinessRate: 1,
  staleDataRate: 0,
  expectedEdgeVsBaseline: 0.02,
  expectedNetExecutionImprovement: 0.02,
  expectedSlippageDelta: 0,
  expectedFillabilityConfidence: 1,
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
});

const buildShadowEvidence = (
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN"
): PairRouteShadowEvidence => ({
  routeClass,
  routeMode: routeClass === "PAIR_PM_LIMITLESS" ? "POLYMARKET_LIMITLESS" : routeClass === "PAIR_PM_PREDICTFUN" ? "POLYMARKET_PREDICT_FUN" : "POLYMARKET_OPINION",
  currentStage: QualificationStage.SHADOW,
  window: {
    windowStart: "2026-03-01T00:00:00.000Z",
    windowEnd: "2026-03-31T00:00:00.000Z",
    freshnessObservedAt: "2026-04-01T00:00:00.000Z"
  },
  routeOverall: buildMetricSlice(),
  exactSafeSubset: buildMetricSlice(),
  shadowOnlySubset: buildMetricSlice(),
  runtimeOverall: buildMetricSlice(),
  runtimeExactSafeSubset: buildMetricSlice(),
  runtimeShadowOnlySubset: buildMetricSlice(),
  countableRuntimeExactSafeSubset: buildMetricSlice(),
  evidenceFresh: true,
  sourceBreakdown: {
    BOOTSTRAP_ARTIFACT: 10,
    RUNTIME_OBSERVATION: 10
  },
  qualityBreakdown: {
    CANARY_COUNTABLE: 10,
    SHADOW_ONLY_NOT_COUNTABLE: 0,
    MIXED_BASIS_REJECTED: 0,
    STALE_REJECTED: 0,
    OUT_OF_SCOPE_REJECTED: 0,
    POLICY_BLOCKED: 0
  }
});

const buildCanaryReadiness = (input: {
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  recommendation: PairCanaryReadiness["recommendation"];
  thresholdResults?: PairCanaryReadiness["thresholdResults"];
  blockerReasons?: readonly string[];
}): PairCanaryReadiness => ({
  routeClass: input.routeClass,
  thresholds: {
    minimumExactSafeObservations: 1,
    minimumFamilyCoverageCount: 1,
    minimumConfidenceStability: 0.9,
    minimumCompatibilityStability: 0.9,
    minimumBasisCleanlinessRate: 0.95,
    maximumStaleDataRate: 0.05,
    maximumMixedBasisRate: 0,
    maximumOperatorOverrideRate: 0.05,
    maximumPolicyBlockRate: 0.1,
    minimumExpectedNetExecutionImprovement: 0,
    maximumExecutionBoundaryIncidentCount: 0,
    maximumReplayProtectionIncidentCount: 0,
    maximumReconciliationIncidentCount: 0,
    maximumVenueHealthFailureRate: 0.05
  },
  thresholdResults: input.thresholdResults ?? [
    { metric: "maximumMixedBasisRate", comparator: "<=", threshold: 0, actual: 0, pass: true }
  ],
  blockerReasons: [...(input.blockerReasons ?? [])],
  recommendation: input.recommendation
});

describe("crypto-prod-readiness", () => {
  it("keeps crypto routes canary-pending when exact-safe evidence and controls pass", async () => {
    const artifacts = await buildCryptoProdArtifacts({
      listPairRoutes: async () => [
        buildRoute({
          routeClassId: "PAIR_PM_LIMITLESS",
          canaryAllowedFamilies: ["CRYPTO:ATH_BY_DATE", "POLITICS:NOMINATION_WINNER"],
          blockedFamilies: ["POLITICS:NOMINATION_WINNER"]
        }),
        buildRoute({
          routeClassId: "PAIR_PM_OPINION",
          canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
        })
      ],
      getShadowEvidence: async (routeClassId) => buildShadowEvidence(routeClassId),
      getCanaryReadiness: async (routeClassId) =>
        buildCanaryReadiness({
          routeClass: routeClassId,
          recommendation: "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
        }),
      getPromotionBlockers: async () => []
    });

    expect(artifacts.readinessSummary.overallDecision).toBe("READY_FOR_CANARY_PENDING_OPERATOR_ACTION");
    expect(artifacts.readinessSummary.routes[0]?.approvedScope.allowedFamilies).toEqual(["CRYPTO:ATH_BY_DATE"]);
    expect(artifacts.readinessSummary.routes[1]?.approvedScope.scopeLabel).toBe("btc_exact_slice_only");
    expect(artifacts.canaryLaunchPlan.eligibleRoutes).toHaveLength(2);
    expect(artifacts.canaryLaunchPlan.eligibleRoutes[0]?.blockedFamilies).not.toContain("CRYPTO:ATH_BY_DATE");
  });

  it("blocks runtime unhealthy crypto routes even when generic canary approval exists", async () => {
    const artifacts = await buildCryptoProdArtifacts({
      listPairRoutes: async () => [
        buildRoute({
          routeClassId: "PAIR_PM_LIMITLESS",
          canaryAllowedFamilies: ["CRYPTO:ATH_BY_DATE"]
        })
      ],
      getShadowEvidence: async () => buildShadowEvidence("PAIR_PM_LIMITLESS"),
      getCanaryReadiness: async () =>
        buildCanaryReadiness({
          routeClass: "PAIR_PM_LIMITLESS",
          recommendation: "CANARY_APPROVED_PENDING_OPERATOR_ACTION",
          thresholdResults: [
            { metric: "maximumExecutionBoundaryIncidentCount", comparator: "<=", threshold: 0, actual: 1, pass: false }
          ],
          blockerReasons: ["execution_boundary_incident"]
        }),
      getPromotionBlockers: async () => ["execution_boundary_incident"]
    });

    expect(artifacts.readinessSummary.routes[0]?.readinessDecision).toBe("BLOCKED_BY_RUNTIME_HEALTH");
    expect(artifacts.canaryLaunchPlan.eligibleRoutes).toHaveLength(0);
  });

  it("blocks routes with no approved crypto canary scope", async () => {
    const artifacts = await buildCryptoProdArtifacts({
      listPairRoutes: async () => [
        buildRoute({
          routeClassId: "PAIR_PM_LIMITLESS",
          canaryAllowedFamilies: ["POLITICS:NOMINATION_WINNER"],
          blockedFamilies: ["POLITICS:NOMINATION_WINNER"]
        })
      ],
      getShadowEvidence: async () => buildShadowEvidence("PAIR_PM_LIMITLESS"),
      getCanaryReadiness: async () =>
        buildCanaryReadiness({
          routeClass: "PAIR_PM_LIMITLESS",
          recommendation: "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
        }),
      getPromotionBlockers: async () => []
    });

    expect(artifacts.readinessSummary.routes[0]?.readinessDecision).toBe("BLOCKED_BY_SCOPE");
    expect(artifacts.rollbackPlan.routes[0]?.rollbackTargetStage).toBe("INTERNAL_ONLY");
  });
});
