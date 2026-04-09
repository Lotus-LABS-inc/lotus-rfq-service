import { readFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";
import { PairShadowObservationRepository } from "./pair-shadow-observation-repository.js";
import type { PairShadowMetricSlice, PairRouteShadowEvidence } from "./pair-shadow-metrics.js";
import type { PairShadowObservation } from "./pair-shadow-observation-types.js";
import { buildPairShadowQualityBreakdown, classifyPairShadowObservationQuality } from "./pair-shadow-quality.js";

const zeroSlice = (): PairShadowMetricSlice => ({
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
});

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const ratio = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

const computeSlice = (observations: readonly PairShadowObservation[]): PairShadowMetricSlice => {
  if (observations.length === 0) {
    return zeroSlice();
  }
  const blockerDistribution = new Map<string, number>();
  const routeChoiceCounts = new Map<string, number>();
  const confidenceHigh = observations.filter((entry) => entry.confidenceState === "HIGH").length;
  const exactCount = observations.filter((entry) => entry.compatibilityState === "EXACT").length;
  const cleanBasis = observations.filter((entry) => !entry.mixedBasis && !entry.insufficientBasis).length;
  const staleCount = observations.filter((entry) => entry.staleData).length;
  const degradedCount = observations.filter((entry) => !entry.liveDataClean || !entry.venueHealthHealthy).length;
  const executionBoundaryIncidentCount = observations.filter((entry) => !entry.executionBoundaryHealthy).length;
  const idempotencyIncidentCount = observations.filter((entry) => Boolean(entry.metadata.idempotencyIncident)).length;
  const replayProtectionIncidentCount = observations.filter((entry) => Boolean(entry.metadata.replayProtectionIncident)).length;
  const reconciliationIncidentCount = observations.filter((entry) => Boolean(entry.metadata.reconciliationIncident)).length;
  const operatorOverrideCount = observations.filter((entry) => Boolean(entry.metadata.operatorOverride)).length;
  const policyBlockCount = observations.filter((entry) => entry.scopeKind === "BLOCKED_FAMILY" || entry.blockedReason !== null).length;
  const mixedBasisCount = observations.filter((entry) => entry.mixedBasis).length;
  const insufficientBasisCount = observations.filter((entry) => entry.insufficientBasis).length;
  const insufficientEvidenceCount = observations.filter((entry) => entry.insufficientEvidence).length;
  const venueHealthFailureCount = observations.filter((entry) => !entry.venueHealthHealthy).length;
  const expectedNetPriceValues = observations.map((entry) => entry.expectedNetPrice ?? 0);
  const expectedEffectiveCostValues = observations.map((entry) => entry.expectedEffectiveCost ?? 0);
  const expectedSlippageValues = observations.map((entry) => entry.expectedSlippage ?? 0);
  const expectedFillabilityValues = observations.map((entry) => entry.expectedFillability ?? 0);

  for (const observation of observations) {
    routeChoiceCounts.set(observation.chosenShadowRoute ?? "NONE", (routeChoiceCounts.get(observation.chosenShadowRoute ?? "NONE") ?? 0) + 1);
    if (observation.blockedReason) {
      blockerDistribution.set(observation.blockedReason, (blockerDistribution.get(observation.blockedReason) ?? 0) + 1);
    }
  }

  const routeChoiceStability = Math.max(...routeChoiceCounts.values()) / observations.length;
  return {
    shadowObservationCount: observations.length,
    eligibleObservationCount: observations.filter((entry) => entry.scopeKind !== "BLOCKED_FAMILY").length,
    exactSafeObservationCount: observations.filter((entry) => entry.scopeKind === "SAFE_EXACT_SUBSET").length,
    blockedObservationCount: observations.filter((entry) => entry.scopeKind === "BLOCKED_FAMILY").length,
    familyCoverageCount: new Set(observations.map((entry) => entry.routeFamily)).size,
    canonicalCoverageCount: new Set(observations.map((entry) => `${entry.canonicalEventId ?? "none"}:${entry.canonicalMarketId ?? "none"}`)).size,
    routeChoiceStability,
    confidenceStability: ratio(confidenceHigh, observations.length),
    compatibilityStability: ratio(exactCount, observations.length),
    basisCleanlinessRate: ratio(cleanBasis, observations.length),
    staleDataRate: ratio(staleCount, observations.length),
    expectedEdgeVsBaseline: average(expectedNetPriceValues) - average(expectedEffectiveCostValues),
    expectedNetExecutionImprovement: average(expectedNetPriceValues) - average(expectedEffectiveCostValues),
    expectedSlippageDelta: average(expectedSlippageValues),
    expectedFillabilityConfidence: average(expectedFillabilityValues),
    routeDegradationRate: ratio(degradedCount, observations.length),
    executionBoundaryIncidentCount,
    idempotencyIncidentCount,
    replayProtectionIncidentCount,
    reconciliationIncidentCount,
    operatorOverrideRate: ratio(operatorOverrideCount, observations.length),
    policyBlockRate: ratio(policyBlockCount, observations.length),
    mixedBasisRate: ratio(mixedBasisCount, observations.length),
    insufficientBasisRate: ratio(insufficientBasisCount, observations.length),
    insufficientEvidenceRate: ratio(insufficientEvidenceCount, observations.length),
    venueHealthFailureRate: ratio(venueHealthFailureCount, observations.length),
    routeClassBlockerDistribution: Object.fromEntries([...blockerDistribution.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  };
};

const inferFamilyFromText = (category: string, text: string): string => {
  const normalized = text.toLowerCase();
  if (category === "CRYPTO" && normalized.includes("all time high")) return "CRYPTO:ATH_BY_DATE";
  if (category === "CRYPTO" && normalized.includes("up or down")) return "CRYPTO:SAME_DAY_DIRECTIONAL";
  if (category === "POLITICS" && normalized.includes("nomination")) return "POLITICS:NOMINATION_WINNER";
  if (category === "SPORTS" && normalized.includes("champion")) return "SPORTS:CHAMPIONSHIP_WINNER";
  if (category === "SPORTS" && normalized.includes("stanley cup")) return "SPORTS:CHAMPIONSHIP_WINNER";
  if (category === "ESPORTS" && normalized.includes("wins")) return "ESPORTS:LEAGUE_WINNER";
  return `${category}:OTHER`;
};

export const buildBootstrapPairShadowObservations = (qualification: PairRouteQualification): readonly PairShadowObservation[] => {
  const now = new Date().toISOString();
  const observations: PairShadowObservation[] = [];

  for (const market of qualification.safeSubsetMarkets) {
    const routeFamily = inferFamilyFromText(market.category, market.titles.join(" "));
    observations.push({
      id: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, market, scopeKind: "SAFE_EXACT_SUBSET" }),
      routeClass: qualification.routeClassId,
      routeMode: qualification.definition.routeMode,
      sourceKind: "BOOTSTRAP_ARTIFACT",
      scopeKind: "SAFE_EXACT_SUBSET",
      scopeKey: `${market.canonicalEventId}:${market.canonicalMarketId ?? "none"}`,
      routeFamily,
      canonicalEventId: market.canonicalEventId,
      canonicalMarketId: market.canonicalMarketId,
      basisMode: "HISTORICAL_ONLY",
      decisionTimestamp: now,
      candidateVenues: qualification.definition.routeMode === "POLYMARKET_LIMITLESS" ? ["POLYMARKET", "LIMITLESS"] : ["POLYMARKET", "OPINION"],
      chosenShadowRoute: qualification.definition.routeMode,
      baselineComparator: "bootstrap_artifact_baseline",
      confidenceState: "HIGH",
      compatibilityState: "EXACT",
      exactnessClass: "semantic_exact_historical_qualified",
      expectedNetPrice: 1,
      expectedEffectiveCost: 0,
      expectedSlippage: 0,
      expectedFillability: 1,
      blockedReason: null,
      staleData: false,
      mixedBasis: false,
      insufficientBasis: false,
      insufficientEvidence: false,
      liveDataClean: qualification.liveQualification.basisClean,
      executionBoundaryHealthy: true,
      venueHealthHealthy: true,
      reproducibilityHash: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, market }),
      replayEnvelopeId: null,
      createdAt: now,
      metadata: {
        bootstrap: true,
        titles: market.titles
      }
    });
  }

  for (const market of qualification.runnableMarkets) {
    const alreadyCovered = observations.some((entry) => entry.scopeKey === `${market.canonicalEventId}:${market.canonicalMarketId ?? "none"}`);
    if (alreadyCovered) continue;
    observations.push({
      id: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, market, scopeKind: "SHADOW_ONLY_SUBSET" }),
      routeClass: qualification.routeClassId,
      routeMode: qualification.definition.routeMode,
      sourceKind: "BOOTSTRAP_ARTIFACT",
      scopeKind: "SHADOW_ONLY_SUBSET",
      scopeKey: `${market.canonicalEventId}:${market.canonicalMarketId ?? "none"}`,
      routeFamily: `${market.category}:OTHER`,
      canonicalEventId: market.canonicalEventId,
      canonicalMarketId: market.canonicalMarketId,
      basisMode: "MIXED_BASIS_DIAGNOSTIC",
      decisionTimestamp: now,
      candidateVenues: market.venues,
      chosenShadowRoute: qualification.definition.routeMode,
      baselineComparator: "bootstrap_shadow_only",
      confidenceState: "MEDIUM",
      compatibilityState: "NEAR_EXACT",
      exactnessClass: "semantic_near_exact",
      expectedNetPrice: 0.5,
      expectedEffectiveCost: 0.45,
      expectedSlippage: 0.05,
      expectedFillability: 0.5,
      blockedReason: null,
      staleData: false,
      mixedBasis: qualification.mixedBasisDiagnostic.routeableMarketCount > 0,
      insufficientBasis: !qualification.liveQualification.basisClean,
      insufficientEvidence: true,
      liveDataClean: qualification.liveQualification.basisClean,
      executionBoundaryHealthy: true,
      venueHealthHealthy: true,
      reproducibilityHash: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, market, shadow: true }),
      replayEnvelopeId: null,
      createdAt: now,
      metadata: {
        bootstrap: true
      }
    });
  }

  for (const family of qualification.blockedFamilies) {
    observations.push({
      id: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, family, scopeKind: "BLOCKED_FAMILY" }),
      routeClass: qualification.routeClassId,
      routeMode: qualification.definition.routeMode,
      sourceKind: "BOOTSTRAP_ARTIFACT",
      scopeKind: "BLOCKED_FAMILY",
      scopeKey: family,
      routeFamily: family,
      canonicalEventId: null,
      canonicalMarketId: null,
      basisMode: "MIXED_BASIS_DIAGNOSTIC",
      decisionTimestamp: now,
      candidateVenues: [],
      chosenShadowRoute: null,
      baselineComparator: "blocked_family_policy",
      confidenceState: "LOW",
      compatibilityState: "BLOCKED",
      exactnessClass: "blocked_by_compatibility",
      expectedNetPrice: null,
      expectedEffectiveCost: null,
      expectedSlippage: null,
      expectedFillability: null,
      blockedReason: "blocked_family_policy",
      staleData: false,
      mixedBasis: false,
      insufficientBasis: false,
      insufficientEvidence: true,
      liveDataClean: false,
      executionBoundaryHealthy: true,
      venueHealthHealthy: true,
      reproducibilityHash: PairShadowObservationRepository.buildReproducibilityHash({ routeClass: qualification.routeClassId, family }),
      replayEnvelopeId: null,
      createdAt: now,
      metadata: {
        bootstrap: true
      }
    });
  }

  return observations;
};

export class PairShadowAggregator {
  public constructor(
    private readonly repository: Pick<PairShadowObservationRepository, "listObservations">,
    private readonly repoRoot: string
  ) {}

  public async listMergedObservations(qualification: PairRouteQualification): Promise<readonly PairShadowObservation[]> {
    const runtime = (await this.repository.listObservations(qualification.routeClassId)).filter(
      (entry) => entry.metadata.verification !== true
    );
    return [...buildBootstrapPairShadowObservations(qualification), ...runtime];
  }

  public async buildEvidence(qualification: PairRouteQualification, windowDays = 14): Promise<PairRouteShadowEvidence> {
    const all = await this.listMergedObservations(qualification);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const withinWindow = all.filter((entry) => entry.decisionTimestamp >= cutoff);
    const runtimeWithinWindow = withinWindow.filter((entry) => entry.sourceKind === "RUNTIME_OBSERVATION");
    const countableRuntimeExactSafe = runtimeWithinWindow.filter(
      (entry) => classifyPairShadowObservationQuality(entry) === "CANARY_COUNTABLE"
    );
    const routeOverall = computeSlice(withinWindow);
    const exactSafeSubset = computeSlice(withinWindow.filter((entry) => entry.scopeKind === "SAFE_EXACT_SUBSET"));
    const shadowOnlySubset = computeSlice(withinWindow.filter((entry) => entry.scopeKind === "SHADOW_ONLY_SUBSET"));
    const sourceBreakdown = {
      BOOTSTRAP_ARTIFACT: withinWindow.filter((entry) => entry.sourceKind === "BOOTSTRAP_ARTIFACT").length,
      RUNTIME_OBSERVATION: withinWindow.filter((entry) => entry.sourceKind === "RUNTIME_OBSERVATION").length
    };
    return {
      routeClass: qualification.routeClassId,
      routeMode: qualification.definition.routeMode,
      currentStage: qualification.currentStage,
      window: {
        windowStart: cutoff,
        windowEnd: new Date().toISOString(),
        freshnessObservedAt: new Date().toISOString()
      },
      routeOverall,
      exactSafeSubset,
      shadowOnlySubset,
      runtimeOverall: computeSlice(runtimeWithinWindow),
      runtimeExactSafeSubset: computeSlice(runtimeWithinWindow.filter((entry) => entry.scopeKind === "SAFE_EXACT_SUBSET")),
      runtimeShadowOnlySubset: computeSlice(runtimeWithinWindow.filter((entry) => entry.scopeKind === "SHADOW_ONLY_SUBSET")),
      countableRuntimeExactSafeSubset: computeSlice(countableRuntimeExactSafe),
      evidenceFresh: withinWindow.every((entry) => !entry.staleData),
      sourceBreakdown,
      qualityBreakdown: buildPairShadowQualityBreakdown(runtimeWithinWindow)
    };
  }
}
