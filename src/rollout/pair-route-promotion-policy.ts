import { QualificationStage } from "../core/qualification/qualification.types.js";
import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";
import { buildDefaultPairRouteGateCategory, evaluatePairRouteGate } from "./pair-route-gating.js";

export class PairRoutePromotionBlockedError extends Error {
  public readonly reasons: readonly string[];

  public constructor(reasons: readonly string[]) {
    super("Pair route promotion blocked.");
    this.name = "PairRoutePromotionBlockedError";
    this.reasons = reasons;
  }
}

export const assertPairRoutePromotionAllowed = (
  qualification: PairRouteQualification,
  targetStage: QualificationStage.SHADOW | QualificationStage.CANARY
): void => {
  const defaultScope = buildDefaultPairRouteGateCategory(qualification.routeClassId);
  const gate = evaluatePairRouteGate({
    qualification,
    targetStage,
    category: defaultScope.category,
    family: defaultScope.family
  });

  if (!gate.allowed) {
    throw new PairRoutePromotionBlockedError(gate.reasons);
  }
};
