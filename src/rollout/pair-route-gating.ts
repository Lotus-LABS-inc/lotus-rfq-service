import { QualificationStage } from "../core/qualification/qualification.types.js";
import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";
import { isPairRouteFamilyAllowed } from "./pair-route-classifier.js";
import type { PairRouteClassId } from "./pair-route-classes.js";

export interface PairRouteGateInput {
  qualification: PairRouteQualification;
  targetStage: QualificationStage.SHADOW | QualificationStage.CANARY;
  category: string;
  family: string;
}

export const evaluatePairRouteGate = (input: PairRouteGateInput): { allowed: boolean; reasons: readonly string[] } => {
  const reasons: string[] = [];
  if (!isPairRouteFamilyAllowed({
    routeClassId: input.qualification.routeClassId,
    category: input.category,
    family: input.family,
    targetStage: input.targetStage
  })) {
    reasons.push("family_not_allowlisted");
  }

  if (input.targetStage === QualificationStage.CANARY) {
    if (input.qualification.readinessState !== "CANARY_READY" && input.qualification.readinessState !== "LIMITED_PROD_READY") {
      reasons.push("readiness_below_canary");
    }
    if (input.qualification.liveQualification.routeableMarketCount === 0) {
      reasons.push("no_live_only_pair_routeability");
    }
  }

  if (input.targetStage === QualificationStage.SHADOW) {
    if (input.qualification.readinessState === "BLOCKED" || input.qualification.readinessState === "NOT_READY") {
      reasons.push("readiness_below_shadow");
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
};

export const buildDefaultPairRouteGateCategory = (routeClassId: PairRouteClassId): { category: string; family: string } =>
  routeClassId === "PAIR_PM_LIMITLESS"
    ? { category: "CRYPTO", family: "CRYPTO:ATH_BY_DATE" }
    : { category: "CRYPTO", family: "CRYPTO:SAME_DAY_DIRECTIONAL" };
