import type { StructuralFingerprint, StructuralMatchResult } from "../matching-types.js";

export const runPoliticsStructuralMatcher = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): StructuralMatchResult => {
  const left = input.leftFingerprint.fingerprint;
  const right = input.rightFingerprint.fingerprint;
  const matchedDimensions: string[] = [];
  const reasons: string[] = [];

  const comparableFields = [
    "family",
    "jurisdiction",
    "office",
    "institution",
    "chamber",
    "branch",
    "cycleYear",
    "contestStage",
    "candidateSetFingerprint",
    "partyStructureFingerprint",
    "thresholdSemantics",
    "dateBoundarySemantics",
    "outcomeStructureType",
    "resolutionBasisFingerprint",
    "eventType"
  ] as const;

  for (const field of comparableFields) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === null || leftValue === undefined || rightValue === null || rightValue === undefined) {
      continue;
    }
    if (leftValue === rightValue) {
      matchedDimensions.push(field);
      continue;
    }
    reasons.push(`${field.toUpperCase()}_MISMATCH`);
  }

  return {
    outcome: reasons.length === 0 ? "EXACT" : "REJECTED",
    reasons,
    matchedDimensions,
    ruleIds: ["politics-structural-matcher-v1"]
  };
};
