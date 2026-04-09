import type { PairRouteClassDefinition, PairRouteReadinessState } from "../rollout/pair-route-classes.js";
import type { PairRouteRiskProfile } from "./pair-route-risk-profile.js";

export const buildPairRouteRiskProfile = (input: {
  definition: PairRouteClassDefinition;
  historicalCounts: { routeableMarketCount: number; eventCount: number };
  liveCounts: { routeableMarketCount: number; eventCount: number };
  mixedCounts: { routeableMarketCount: number; eventCount: number };
  exactHistoricalQualifiedCount: number;
  exactLiveOnlyCount: number;
  nearExactCount: number;
  dominantBlockers: readonly string[];
  safeSubsetCount: number;
}): PairRouteRiskProfile => {
  let basisCleanliness: PairRouteRiskProfile["basisCleanliness"] = "INSUFFICIENT";
  if (input.liveCounts.routeableMarketCount > 0 || input.exactLiveOnlyCount > 0) {
    basisCleanliness = "LIVE_STRONG";
  } else if (input.historicalCounts.routeableMarketCount > 0 || input.exactHistoricalQualifiedCount > 0 || input.safeSubsetCount > 0) {
    basisCleanliness = "HISTORICAL_STRONG";
  } else if (input.mixedCounts.routeableMarketCount > 0) {
    basisCleanliness = "MIXED_ONLY";
  }

  const compatibilityQuality =
    input.exactLiveOnlyCount > 0 ? "HIGH"
      : input.exactHistoricalQualifiedCount > 0 || input.safeSubsetCount > 0 ? "MEDIUM"
      : "LOW";
  const provenanceQuality =
    basisCleanliness === "LIVE_STRONG" || basisCleanliness === "HISTORICAL_STRONG" ? "HIGH"
      : basisCleanliness === "MIXED_ONLY" ? "MEDIUM"
      : "LOW";

  let recommendedReadinessCap: PairRouteReadinessState = "BLOCKED";
  if (basisCleanliness === "LIVE_STRONG" && input.exactLiveOnlyCount > 0) {
    recommendedReadinessCap = "CANARY_READY";
  } else if (
    basisCleanliness === "HISTORICAL_STRONG" ||
    basisCleanliness === "MIXED_ONLY" ||
    input.safeSubsetCount > 0 ||
    input.nearExactCount > 0
  ) {
    recommendedReadinessCap = "SHADOW_READY";
  }

  const operationalConcerns = [
    ...(basisCleanliness === "MIXED_ONLY" ? ["Mixed-basis evidence cannot drive promotion."] : []),
    ...(basisCleanliness !== "LIVE_STRONG" ? ["No clean live-only pair routeability yet."] : []),
    ...(input.definition.id === "PAIR_PM_LIMITLESS" ? ["Canary must stay on the exact-safe subset only."] : []),
    ...(input.definition.id === "PAIR_PM_OPINION" ? ["Broader PM+Opinion near-exacts remain blocked outside the exact BTC slice."] : [])
  ];

  return {
    basisCleanliness,
    dominantBlockers: input.dominantBlockers,
    compatibilityQuality,
    provenanceQuality,
    operationalConcerns,
    summary:
      recommendedReadinessCap === "CANARY_READY"
        ? "Clean live-only evidence exists for a promotable exact slice."
        : recommendedReadinessCap === "SHADOW_READY"
          ? "Evidence is sufficient for shadow observation, but not for live canary promotion."
          : "Evidence is insufficient for safe rollout.",
    recommendedReadinessCap
  };
};
