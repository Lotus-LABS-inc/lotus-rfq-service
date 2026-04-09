import { QualificationStage } from "../core/qualification/qualification.types.js";
import {
  PairRouteClassDefinitions,
  getPairRouteClassDefinition,
  type PairRouteClassDefinition,
  type PairRouteClassId
} from "./pair-route-classes.js";

export interface PairRouteCandidateScope {
  routeClassId: PairRouteClassId;
  category: string;
  family: string;
  targetStage: QualificationStage;
}

const stageUsesCanaryAllowlist = (stage: QualificationStage): boolean =>
  stage === QualificationStage.CANARY ||
  stage === QualificationStage.LIMITED_PROD ||
  stage === QualificationStage.BROAD_PROD;

const familyMatches = (candidateFamily: string, allowlistedFamily: string): boolean =>
  allowlistedFamily.endsWith("*")
    ? candidateFamily.startsWith(allowlistedFamily.slice(0, -1))
    : candidateFamily === allowlistedFamily;

export const getPairRouteClassByRouteMode = (
  routeMode: PairRouteClassDefinition["routeMode"]
): PairRouteClassDefinition | null =>
  PairRouteClassDefinitions.find((entry) => entry.routeMode === routeMode) ?? null;

export const isPairRouteFamilyAllowed = (input: PairRouteCandidateScope): boolean => {
  const definition = getPairRouteClassDefinition(input.routeClassId);
  if (!definition.allowedCategories.includes(input.category)) {
    return false;
  }

  if (definition.blockedFamilies.some((family) => familyMatches(input.family, family))) {
    return false;
  }

  const allowlist = stageUsesCanaryAllowlist(input.targetStage)
    ? definition.canaryAllowedFamilies
    : definition.shadowAllowedFamilies;
  return allowlist.some((family) => familyMatches(input.family, family));
};
