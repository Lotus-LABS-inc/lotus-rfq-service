import { QualificationStage } from "../core/qualification/qualification.types.js";

export type PairRouteClassId = "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
export type PairRouteBasisMode = "HISTORICAL_ONLY" | "LIVE_ONLY" | "MIXED_BASIS_DIAGNOSTIC";
export type PairRouteReadinessState =
  | "NOT_READY"
  | "SHADOW_READY"
  | "CANARY_READY"
  | "LIMITED_PROD_READY"
  | "BLOCKED";

export interface PairRouteClassDefinition {
  id: PairRouteClassId;
  routeMode: "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION" | "POLYMARKET_PREDICT_FUN";
  label: string;
  supportedBasisModes: readonly PairRouteBasisMode[];
  allowedCategories: readonly string[];
  shadowAllowedFamilies: readonly string[];
  canaryAllowedFamilies: readonly string[];
  blockedFamilies: readonly string[];
  qualificationStatus: "EVIDENCE_GATED";
  rolloutStatus: QualificationStage;
  knownLimitations: readonly string[];
  operatorNotes: readonly string[];
}

export const PairRouteClassDefinitions: readonly PairRouteClassDefinition[] = [
  {
    id: "PAIR_PM_LIMITLESS",
    routeMode: "POLYMARKET_LIMITLESS",
    label: "Predexon + Limitless Pair Route",
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO", "POLITICS", "SPORTS", "ESPORTS"],
    shadowAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE",
      "POLITICS:NOMINATION_WINNER",
      "SPORTS:CHAMPIONSHIP_WINNER",
      "ESPORTS:LEAGUE_WINNER"
    ],
    canaryAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE",
      "POLITICS:NOMINATION_WINNER"
    ],
    blockedFamilies: [
      "CRYPTO:SAME_DAY_DIRECTIONAL",
      "CRYPTO:THRESHOLD_BY_DATE",
      "SPORTS:MATCHUP_WINNER",
      "ESPORTS:MATCHUP_WINNER"
    ],
    qualificationStatus: "EVIDENCE_GATED",
    rolloutStatus: QualificationStage.INTERNAL_ONLY,
    knownLimitations: [
      "Broad runnable PM+Limitless coverage is not equivalent to canary-safe overlap.",
      "Clean live-only pair routeability is still zero, so promotion must stay subset-gated."
    ],
    operatorNotes: [
      "Shadow may observe the broader route class.",
      "Canary and production remain limited to compatibility-safe exact subsets."
    ]
  },
  {
    id: "PAIR_PM_OPINION",
    routeMode: "POLYMARKET_OPINION",
    label: "Predexon + Opinion Pair Route",
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO"],
    shadowAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"],
    canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"],
    blockedFamilies: [
      "CRYPTO:ATH_BY_DATE",
      "CRYPTO:THRESHOLD_BY_DATE",
      "SPORTS:*",
      "ESPORTS:*",
      "POLITICS:*"
    ],
    qualificationStatus: "EVIDENCE_GATED",
    rolloutStatus: QualificationStage.INTERNAL_ONLY,
    knownLimitations: [
      "Current defensible production slice is the exact BTC March 21 pair only.",
      "Broader PM+Opinion inventory is still dominated by near-exacts and timing mismatches."
    ],
    operatorNotes: [
      "Use the exact BTC slice as the initial shadow target.",
      "Do not treat broader PM+Opinion near-exact families as canary-eligible."
    ]
  }
  ,
  {
    id: "PAIR_PM_PREDICTFUN",
    routeMode: "POLYMARKET_PREDICT_FUN",
    label: "Polymarket + Predict.fun Pair Route",
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO", "POLITICS", "SPORTS"],
    shadowAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE",
      "CRYPTO:SAME_DAY_DIRECTIONAL",
      "POLITICS:NOMINATION_WINNER"
    ],
    canaryAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    blockedFamilies: [
      "CRYPTO:THRESHOLD_BY_DATE",
      "SPORTS:MATCHUP_WINNER",
      "ESPORTS:*"
    ],
    qualificationStatus: "EVIDENCE_GATED",
    rolloutStatus: QualificationStage.INTERNAL_ONLY,
    knownLimitations: [
      "Predict.fun and Polymarket market structure may diverge on resolution timing.",
      "PREDICT_FUN venue is aliased as PREDICT in catalog — normalise before edge lookup."
    ],
    operatorNotes: [
      "Review PREDICT_FUN pair edges in /admin/pair-match-review before enabling this route class.",
      "Confirm PREDICT_FUN venue readiness in /admin/execution-venues before canary."
    ]
  }
] as const;

export const getPairRouteClassDefinition = (routeClassId: PairRouteClassId): PairRouteClassDefinition => {
  const definition = PairRouteClassDefinitions.find((entry) => entry.id === routeClassId);
  if (!definition) {
    throw new Error(`Unknown pair route class: ${routeClassId}`);
  }
  return definition;
};
