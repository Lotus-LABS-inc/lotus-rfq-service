export type PairShadowSourceKind = "BOOTSTRAP_ARTIFACT" | "RUNTIME_OBSERVATION";
export type PairShadowScopeKind = "SAFE_EXACT_SUBSET" | "SHADOW_ONLY_SUBSET" | "BLOCKED_FAMILY";
export type PairShadowBasisMode = "HISTORICAL_ONLY" | "LIVE_ONLY" | "MIXED_BASIS_DIAGNOSTIC";
export type PairShadowConfidenceState = "HIGH" | "MEDIUM" | "LOW";
export type PairShadowCompatibilityState = "EXACT" | "NEAR_EXACT" | "BLOCKED";
export type PairShadowExactnessClass =
  | "semantic_exact_historical_qualified"
  | "semantic_exact_live_only"
  | "semantic_near_exact"
  | "proxy_or_mismatch"
  | "blocked_by_compatibility";

export interface PairShadowObservation {
  id: string;
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  routeMode: "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION" | "POLYMARKET_PREDICT_FUN";
  sourceKind: PairShadowSourceKind;
  scopeKind: PairShadowScopeKind;
  scopeKey: string;
  routeFamily: string;
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  basisMode: PairShadowBasisMode;
  decisionTimestamp: string;
  candidateVenues: readonly string[];
  chosenShadowRoute: string | null;
  baselineComparator: string | null;
  confidenceState: PairShadowConfidenceState;
  compatibilityState: PairShadowCompatibilityState;
  exactnessClass: PairShadowExactnessClass;
  expectedNetPrice: number | null;
  expectedEffectiveCost: number | null;
  expectedSlippage: number | null;
  expectedFillability: number | null;
  blockedReason: string | null;
  staleData: boolean;
  mixedBasis: boolean;
  insufficientBasis: boolean;
  insufficientEvidence: boolean;
  liveDataClean: boolean;
  executionBoundaryHealthy: boolean;
  venueHealthHealthy: boolean;
  reproducibilityHash: string;
  replayEnvelopeId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface CreatePairShadowObservationInput extends Omit<PairShadowObservation, "id" | "createdAt"> {
  id?: string;
  createdAt?: string;
}

export interface PairPromotionDecisionRecord {
  id: string;
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  scopePromoted: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  metricsSnapshot: Record<string, unknown>;
  thresholdsEvaluated: Record<string, unknown>;
  pass: boolean;
  operatorIdentity: string;
  previousRolloutState: string;
  newRolloutState: string;
  rollbackReference: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface CreatePairPromotionDecisionInput extends Omit<PairPromotionDecisionRecord, "id" | "createdAt"> {
  id?: string;
  createdAt?: string;
}
