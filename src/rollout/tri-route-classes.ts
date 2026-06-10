import { QualificationStage } from "../core/qualification/qualification.types.js";

export type TriRouteClassId =
  | "TRI_PM_LIMITLESS_OPINION"
  | "TRI_PM_LIMITLESS_PREDICTFUN"
  | "TRI_PM_OPINION_PREDICTFUN";
export type TriRouteBasisMode = "HISTORICAL_ONLY" | "LIVE_ONLY" | "MIXED_BASIS_DIAGNOSTIC";

// STRICT_ALL is the production tier for tri routes.
// A candidate reaches STRICT_ALL when every constituent pair edge is EXACT + approved
// and all 3 venues are simultaneously execution-ready with zero near-exact fallbacks.
export type TriRouteReadinessState =
  | "NOT_READY"
  | "SHADOW_READY"
  | "CANARY_READY"
  | "STRICT_ALL"
  | "BLOCKED";

export interface TriRouteClassDefinition {
  id: TriRouteClassId;
  routeMode: "POLYMARKET_LIMITLESS_OPINION" | "POLYMARKET_LIMITLESS_PREDICT_FUN" | "POLYMARKET_OPINION_PREDICT_FUN";
  label: string;
  constituentPairClasses: readonly string[];
  supportedBasisModes: readonly TriRouteBasisMode[];
  allowedCategories: readonly string[];
  shadowAllowedFamilies: readonly string[];
  canaryAllowedFamilies: readonly string[];
  strictAllAllowedFamilies: readonly string[];
  blockedFamilies: readonly string[];
  qualificationStatus: "EVIDENCE_GATED";
  rolloutStatus: QualificationStage;
  knownLimitations: readonly string[];
  operatorNotes: readonly string[];
}

export const TriRouteClassDefinitions: readonly TriRouteClassDefinition[] = [
  {
    id: "TRI_PM_LIMITLESS_OPINION",
    routeMode: "POLYMARKET_LIMITLESS_OPINION",
    label: "Polymarket + Limitless + Opinion Tri Route",
    constituentPairClasses: ["PAIR_PM_LIMITLESS", "PAIR_PM_OPINION"],
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO"],
    shadowAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE",
      "CRYPTO:SAME_DAY_DIRECTIONAL"
    ],
    canaryAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    strictAllAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    blockedFamilies: [
      "CRYPTO:THRESHOLD_BY_DATE",
      "SPORTS:*",
      "ESPORTS:*",
      "POLITICS:*"
    ],
    qualificationStatus: "EVIDENCE_GATED",
    rolloutStatus: QualificationStage.INTERNAL_ONLY,
    knownLimitations: [
      "Tri routing requires all 3 constituent pair edges (PM-Limitless, PM-Opinion, Limitless-Opinion) to be EXACT + approved simultaneously.",
      "No PAIR_LIMITLESS_OPINION route class exists — tri candidates are derived only from PM-shared exact overlaps.",
      "STRICT_ALL requires all 3 venues to be simultaneously execution-ready with zero near-exact fallbacks."
    ],
    operatorNotes: [
      "Approve constituent pair edges in /admin/pair-match-review to unlock tri candidates.",
      "STRICT_ALL is the only production tier for tri routes — partial exact coverage does not qualify.",
      "Monitor /admin/tri-match-review/candidates before promoting from shadow to canary."
    ]
  }
  ,
  {
    id: "TRI_PM_LIMITLESS_PREDICTFUN",
    routeMode: "POLYMARKET_LIMITLESS_PREDICT_FUN",
    label: "Polymarket + Limitless + Predict.fun Tri Route",
    constituentPairClasses: ["PAIR_PM_LIMITLESS", "PAIR_PM_PREDICTFUN"],
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO"],
    shadowAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    canaryAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    strictAllAllowedFamilies: [
      "CRYPTO:ATH_BY_DATE"
    ],
    blockedFamilies: [
      "CRYPTO:THRESHOLD_BY_DATE",
      "CRYPTO:SAME_DAY_DIRECTIONAL",
      "SPORTS:*",
      "ESPORTS:*",
      "POLITICS:*"
    ],
    qualificationStatus: "EVIDENCE_GATED",
    rolloutStatus: QualificationStage.INTERNAL_ONLY,
    knownLimitations: [
      "Requires PM-Limitless and PM-PredictFun pair edges to both be EXACT + approved.",
      "PREDICT_FUN is aliased as PREDICT in catalog — pair edge lookup must normalise venue names.",
      "STRICT_ALL requires all 3 venues simultaneously execution-ready."
    ],
    operatorNotes: [
      "Confirm PAIR_PM_PREDICTFUN route class edges are approved before expecting tri candidates.",
      "Monitor Predict.fun execution readiness in /admin/execution-venues before promoting."
    ]
  },
  {
    id: "TRI_PM_OPINION_PREDICTFUN",
    routeMode: "POLYMARKET_OPINION_PREDICT_FUN",
    label: "Polymarket + Opinion + Predict.fun Tri Route",
    constituentPairClasses: ["PAIR_PM_OPINION", "PAIR_PM_PREDICTFUN"],
    supportedBasisModes: ["HISTORICAL_ONLY", "LIVE_ONLY", "MIXED_BASIS_DIAGNOSTIC"],
    allowedCategories: ["CRYPTO"],
    shadowAllowedFamilies: [
      "CRYPTO:SAME_DAY_DIRECTIONAL"
    ],
    canaryAllowedFamilies: [],
    strictAllAllowedFamilies: [],
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
      "Opinion market inventory is primarily SAME_DAY_DIRECTIONAL — narrow overlap with PredictFun.",
      "No canary or STRICT_ALL families approved until PM-Opinion canary evidence is established first."
    ],
    operatorNotes: [
      "This route class should not be promoted ahead of TRI_PM_LIMITLESS_OPINION.",
      "Audit PAIR_PM_OPINION and PAIR_PM_PREDICTFUN edge inventories before considering shadow."
    ]
  }
] as const;

export const getTriRouteClassDefinition = (routeClassId: TriRouteClassId): TriRouteClassDefinition => {
  const definition = TriRouteClassDefinitions.find((entry) => entry.id === routeClassId);
  if (!definition) {
    throw new Error(`Unknown tri route class: ${routeClassId}`);
  }
  return definition;
};
