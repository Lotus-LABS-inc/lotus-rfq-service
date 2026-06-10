import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writePairCanaryReadinessArtifacts } from "../../src/operations/semantic-expansion/pair-canary-readiness-summary.js";
import { readArtifact } from "../../src/operations/semantic-expansion/shared.js";
import type { PairRouteShadowEvidence } from "../../src/shadow/pair-shadow-metrics.js";
import type { PairCanaryReadiness } from "../../src/rollout/pair-canary-readiness-evaluator.js";
import { getPairRouteClassDefinition } from "../../src/rollout/pair-route-classes.js";
import type { PairRouteQualification } from "../../src/qualification/pair-route-qualification.js";
import { QualificationStage } from "../../src/core/qualification/qualification.types.js";

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

const buildQualification = (routeClassId: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION"): PairRouteQualification => ({
  routeClassId,
  definition: getPairRouteClassDefinition(routeClassId),
  currentStage: QualificationStage.SHADOW,
  readinessState: "SHADOW_READY",
  historicalQualification: {
    routeableMarketCount: 1,
    eventCount: 1,
    exactHistoricalQualifiedCount: 1,
    basisClean: true
  },
  liveQualification: {
    routeableMarketCount: 1,
    eventCount: 1,
    exactLiveOnlyCount: routeClassId === "PAIR_PM_OPINION" ? 1 : 0,
    basisClean: true
  },
  mixedBasisDiagnostic: {
    routeableMarketCount: 0,
    eventCount: 0
  },
  exactNearExactDistribution: {
    exactHistoricalQualifiedCount: 1,
    exactLiveOnlyCount: routeClassId === "PAIR_PM_OPINION" ? 1 : 0,
    nearExactCount: 0,
    noCandidateCount: 0
  },
  safeSubsetMarkets: [],
  runnableMarkets: [],
  riskProfile: {
    basisCleanliness: "LIVE_STRONG",
    dominantBlockers: [],
    compatibilityQuality: "HIGH",
    provenanceQuality: "HIGH",
    operationalConcerns: [],
    summary: "test profile",
    recommendedReadinessCap: "CANARY_READY"
  },
  recommendation: "SHADOW",
  supportedFamilies: [],
  blockedFamilies: [],
  evidenceRefs: []
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pair promotion evidence artifacts", () => {
  it("writes evidence summaries and synchronizes the delivery checklist", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "lotus-pair-canary-"));
    tempDirs.push(repoRoot);

    const getShadowEvidence = async (
      routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION"
    ): Promise<PairRouteShadowEvidence> => ({
      routeClass,
      routeMode: routeClass === "PAIR_PM_LIMITLESS" ? "POLYMARKET_LIMITLESS" : "POLYMARKET_OPINION",
      currentStage: "SHADOW",
      window: {
        windowStart: "2026-03-20T00:00:00.000Z",
        windowEnd: "2026-03-29T00:00:00.000Z",
        freshnessObservedAt: "2026-03-29T00:00:00.000Z"
      },
      routeOverall: {
        ...zeroSlice,
        shadowObservationCount: 5
      },
      exactSafeSubset: {
        ...zeroSlice,
        exactSafeObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 1
      },
      shadowOnlySubset: {
        ...zeroSlice
      },
      runtimeOverall: {
        ...zeroSlice,
        shadowObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 0
      },
      runtimeExactSafeSubset: {
        ...zeroSlice,
        exactSafeObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 0
      },
      runtimeShadowOnlySubset: {
        ...zeroSlice
      },
      countableRuntimeExactSafeSubset: {
        ...zeroSlice,
        shadowObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 0,
        exactSafeObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 0,
        familyCoverageCount: routeClass === "PAIR_PM_OPINION" ? 1 : 0,
        confidenceStability: routeClass === "PAIR_PM_OPINION" ? 1 : 0,
        compatibilityStability: routeClass === "PAIR_PM_OPINION" ? 1 : 0,
        basisCleanlinessRate: routeClass === "PAIR_PM_OPINION" ? 1 : 0,
        expectedNetExecutionImprovement: routeClass === "PAIR_PM_OPINION" ? 0.02 : 0
      },
      evidenceFresh: true,
      sourceBreakdown: {
        BOOTSTRAP_ARTIFACT: 1,
        RUNTIME_OBSERVATION: routeClass === "PAIR_PM_OPINION" ? 3 : 0
      },
      qualityBreakdown: {
        CANARY_COUNTABLE: routeClass === "PAIR_PM_OPINION" ? 3 : 0,
        SHADOW_ONLY_NOT_COUNTABLE: 0,
        MIXED_BASIS_REJECTED: 0,
        STALE_REJECTED: 0,
        OUT_OF_SCOPE_REJECTED: 0,
        POLICY_BLOCKED: 0
      }
    });

    const getCanaryReadiness = async (
      routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION"
    ): Promise<PairCanaryReadiness> => ({
      routeClass,
      thresholds: {} as never,
      thresholdResults: [
        {
          metric: "minimumExactSafeObservations",
          pass: routeClass === "PAIR_PM_OPINION",
          actual: routeClass === "PAIR_PM_OPINION" ? 3 : 1,
          threshold: routeClass === "PAIR_PM_OPINION" ? 3 : 5,
          comparator: ">="
        }
      ],
      blockerReasons: routeClass === "PAIR_PM_OPINION" ? [] : ["minimumExactSafeObservations"],
      recommendation: routeClass === "PAIR_PM_OPINION" ? "CANARY_APPROVED_PENDING_OPERATOR_ACTION" : "REMAIN_SHADOW"
    });

    const adminService = {
      listPairRoutes: async () => [buildQualification("PAIR_PM_LIMITLESS"), buildQualification("PAIR_PM_OPINION")],
      getShadowEvidence,
      getCanaryReadiness,
      getPromotionBlockers: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") =>
        routeClass === "PAIR_PM_OPINION" ? [] : ["minimumExactSafeObservations"]
    };

    await writePairCanaryReadinessArtifacts(repoRoot, adminService);

    const readinessJson = readArtifact<{ routes: Array<{ routeClass: string; canaryReadiness: { recommendation: string } }> }>(
      repoRoot,
      "docs/pair-canary-readiness-summary.json"
    );
    const checklist = readFileSync(path.resolve(repoRoot, "docs/delivery/pair-first-production-checklist.md"), "utf8");

    expect(readinessJson.routes).toHaveLength(2);
    expect(checklist).toContain("live evidence sufficient for canary");
    expect(checklist).toContain("canary recommendation");
    expect(checklist).toContain("PAIR_PM_OPINION");
    expect(checklist).toContain("CANARY_APPROVED_PENDING_OPERATOR_ACTION");
  });
});
