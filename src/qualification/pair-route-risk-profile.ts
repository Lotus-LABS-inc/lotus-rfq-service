import type { PairRouteReadinessState } from "../rollout/pair-route-classes.js";

export interface PairRouteRiskProfile {
  basisCleanliness: "HISTORICAL_STRONG" | "LIVE_STRONG" | "MIXED_ONLY" | "INSUFFICIENT";
  dominantBlockers: readonly string[];
  compatibilityQuality: "HIGH" | "MEDIUM" | "LOW";
  provenanceQuality: "HIGH" | "MEDIUM" | "LOW";
  operationalConcerns: readonly string[];
  summary: string;
  recommendedReadinessCap: PairRouteReadinessState;
}
