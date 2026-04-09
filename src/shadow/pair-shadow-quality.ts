import type { PairShadowObservation } from "./pair-shadow-observation-types.js";

export type PairShadowObservationQuality =
  | "CANARY_COUNTABLE"
  | "SHADOW_ONLY_NOT_COUNTABLE"
  | "MIXED_BASIS_REJECTED"
  | "STALE_REJECTED"
  | "OUT_OF_SCOPE_REJECTED"
  | "POLICY_BLOCKED";

const isAuthoritativeStagingRuntimeObservation = (observation: PairShadowObservation): boolean =>
  observation.sourceKind === "RUNTIME_OBSERVATION"
  && observation.metadata.topUp !== true
  && observation.metadata.runtimeSource === "staging_replay_harness"
  && observation.metadata.authoritativeWindow === "staging_shadow_slice";

export const classifyPairShadowObservationQuality = (
  observation: PairShadowObservation
): PairShadowObservationQuality => {
  if (!isAuthoritativeStagingRuntimeObservation(observation)) {
    return "OUT_OF_SCOPE_REJECTED";
  }
  if (observation.scopeKind === "BLOCKED_FAMILY" || observation.blockedReason !== null) {
    return "POLICY_BLOCKED";
  }
  if (observation.mixedBasis || observation.basisMode !== "LIVE_ONLY" || observation.insufficientBasis) {
    return "MIXED_BASIS_REJECTED";
  }
  if (observation.staleData || !observation.liveDataClean) {
    return "STALE_REJECTED";
  }
  if (observation.scopeKind !== "SAFE_EXACT_SUBSET" || observation.insufficientEvidence) {
    return "SHADOW_ONLY_NOT_COUNTABLE";
  }
  return "CANARY_COUNTABLE";
};

export const buildPairShadowQualityBreakdown = (
  observations: readonly PairShadowObservation[]
): Record<PairShadowObservationQuality, number> => {
  const counts: Record<PairShadowObservationQuality, number> = {
    CANARY_COUNTABLE: 0,
    SHADOW_ONLY_NOT_COUNTABLE: 0,
    MIXED_BASIS_REJECTED: 0,
    STALE_REJECTED: 0,
    OUT_OF_SCOPE_REJECTED: 0,
    POLICY_BLOCKED: 0
  };
  for (const observation of observations) {
    counts[classifyPairShadowObservationQuality(observation)] += 1;
  }
  return counts;
};
