import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";
import type { PairRouteShadowEvidence } from "../shadow/pair-shadow-metrics.js";
import { evaluatePairCanaryReadiness, type PairCanaryReadiness } from "./pair-canary-readiness-evaluator.js";

export interface PairPromotionEvidencePolicyResult {
  qualification: PairRouteQualification;
  evidence: PairRouteShadowEvidence;
  canaryReadiness: PairCanaryReadiness;
}

export const buildPairPromotionEvidencePolicy = (
  qualification: PairRouteQualification,
  evidence: PairRouteShadowEvidence
): PairPromotionEvidencePolicyResult => ({
  qualification,
  evidence,
  canaryReadiness: evaluatePairCanaryReadiness(qualification.routeClassId, evidence)
});
