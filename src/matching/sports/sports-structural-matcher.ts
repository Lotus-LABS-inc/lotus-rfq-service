import type { StructuralFingerprint, StructuralMatchResult } from "../matching-types.js";

const STRUCTURAL_RULE_VERSION = "sports-structural-matcher-v1";

export interface SportsStructuralMatchResult extends StructuralMatchResult {
  mismatchedDimensions: readonly string[];
}

const matchDimension = (matched: string[], mismatched: string[], name: string, condition: boolean): void => {
  if (condition) {
    matched.push(name);
    return;
  }
  mismatched.push(name);
};

export const runSportsStructuralMatcher = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): SportsStructuralMatchResult => {
  const left = input.leftFingerprint.fingerprint;
  const right = input.rightFingerprint.fingerprint;
  const matched: string[] = [];
  const mismatched: string[] = [];

  matchDimension(matched, mismatched, "domain", left.domain === right.domain);
  matchDimension(matched, mismatched, "family", left.family === right.family);
  matchDimension(matched, mismatched, "competitionKey", left.competitionKey === right.competitionKey);
  matchDimension(matched, mismatched, "competitionScope", left.competitionScope === right.competitionScope);
  matchDimension(matched, mismatched, "dateKey", left.dateKey === right.dateKey);
  matchDimension(matched, mismatched, "binaryStructure", left.binaryStructure === right.binaryStructure);
  matchDimension(matched, mismatched, "outcomeMappingBasis", left.outcomeMappingBasis === right.outcomeMappingBasis);

  if (left.family === "MATCHUP_WINNER") {
    matchDimension(matched, mismatched, "matchupKey", left.matchupKey === right.matchupKey);
    matchDimension(matched, mismatched, "scheduledBoundaryKey", left.scheduledBoundaryKey === right.scheduledBoundaryKey);
  } else {
    matchDimension(matched, mismatched, "subjectEntity", left.subjectEntity === right.subjectEntity);
    matchDimension(matched, mismatched, "cutoffTimestamp", left.timezoneNormalizedCutoffKey === right.timezoneNormalizedCutoffKey);
  }

  if (mismatched.length === 0) {
    return {
      outcome: "EXACT",
      reasons: ["sports_structural_exact"],
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: [STRUCTURAL_RULE_VERSION]
    };
  }

  const classifierCompatible = mismatched.every((value) => value === "scheduledBoundaryKey" || value === "cutoffTimestamp");
  if (classifierCompatible) {
    return {
      outcome: "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER",
      reasons: mismatched.map((value) => `structural:${value}_mismatch`),
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: [STRUCTURAL_RULE_VERSION, "compatible_for_sports_classifier"]
    };
  }

  return {
    outcome: "REJECTED",
    reasons: mismatched.map((value) => `structural:${value}_mismatch`),
    matchedDimensions: matched,
    mismatchedDimensions: mismatched,
    ruleIds: [STRUCTURAL_RULE_VERSION, "structural_rejected"]
  };
};
