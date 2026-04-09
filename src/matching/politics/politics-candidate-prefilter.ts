import type { CandidatePrefilterResult, StructuralFingerprint } from "../matching-types.js";
import type { PoliticsDerivedFamilyDefinition, PoliticsFamilyEligibility, PoliticsPairRejection } from "./politics-types.js";

const FIELD_TO_REASON: Partial<Record<string, PoliticsPairRejection>> = {
  jurisdiction: "JURISDICTION_MISMATCH",
  office: "OFFICE_MISMATCH",
  institution: "INSTITUTION_MISMATCH",
  chamber: "CHAMBER_MISMATCH",
  cycleYear: "CYCLE_MISMATCH",
  contestStage: "STAGE_MISMATCH",
  candidateSetFingerprint: "CANDIDATE_SET_MISMATCH",
  partyStructureFingerprint: "PARTY_STRUCTURE_MISMATCH",
  thresholdSemantics: "THRESHOLD_STRUCTURE_MISMATCH",
  dateBoundarySemantics: "DATE_WINDOW_MISMATCH",
  outcomeStructureType: "OUTCOME_STRUCTURE_MISMATCH",
  resolutionBasisFingerprint: "RESOLUTION_RULE_MISMATCH"
};

export const prefilterPoliticsCandidatePair = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  leftEligibility: PoliticsFamilyEligibility;
  rightEligibility: PoliticsFamilyEligibility;
  definition: PoliticsDerivedFamilyDefinition | undefined;
}): CandidatePrefilterResult => {
  const left = input.leftFingerprint.fingerprint;
  const right = input.rightFingerprint.fingerprint;
  const reasons: PoliticsPairRejection[] = [];

  if (input.leftEligibility !== "MATCHING_ELIGIBLE" || input.rightEligibility !== "MATCHING_ELIGIBLE") {
    reasons.push("FAMILY_NOT_MATCHING_ELIGIBLE");
  }
  if (left["family"] !== right["family"]) {
    reasons.push("FAMILY_MISMATCH");
  }
  if ((left["missingCriticalComponents"] as readonly string[] | undefined)?.length || (right["missingCriticalComponents"] as readonly string[] | undefined)?.length) {
    reasons.push("UNKNOWN_CRITICAL_FIELD");
  }
  for (const field of input.definition?.requiredStructuralFields ?? []) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === null || leftValue === undefined || rightValue === null || rightValue === undefined) {
      reasons.push("UNKNOWN_CRITICAL_FIELD");
      continue;
    }
    if (leftValue !== rightValue) {
      reasons.push(FIELD_TO_REASON[field] ?? "FAMILY_MISMATCH");
    }
  }
  if (left["resolutionBasisFingerprint"] !== right["resolutionBasisFingerprint"] && left["resolutionBasisFingerprint"] && right["resolutionBasisFingerprint"]) {
    reasons.push("RESOLUTION_RULE_MISMATCH");
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    ruleIds: ["politics-candidate-prefilter-v1"]
  };
};
