import { QualificationStage } from "../core/qualification/qualification.types.js";
import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";

export const assertPairRouteDemotionAllowed = (
  qualification: PairRouteQualification,
  targetStage: QualificationStage
): void => {
  const currentOrder = [
    QualificationStage.INTERNAL_ONLY,
    QualificationStage.SHADOW,
    QualificationStage.CANARY,
    QualificationStage.LIMITED_PROD,
    QualificationStage.BROAD_PROD
  ];
  const currentIndex = currentOrder.indexOf(qualification.currentStage);
  const targetIndex = currentOrder.indexOf(targetStage);
  if (targetIndex === -1 || currentIndex === -1 || targetIndex > currentIndex) {
    throw new Error("Demotion target stage must not be higher than the current stage.");
  }
};
