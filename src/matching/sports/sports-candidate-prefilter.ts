import type { CandidatePrefilterResult, StructuralFingerprint } from "../matching-types.js";

const RULE_ID = "sports-candidate-prefilter-v1";

const pushIf = (condition: boolean, reasons: string[], reason: string): void => {
  if (!condition) {
    reasons.push(reason);
  }
};

export const prefilterSportsCandidatePair = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): CandidatePrefilterResult => {
  const left = input.leftFingerprint.fingerprint;
  const right = input.rightFingerprint.fingerprint;
  const reasons: string[] = [];

  pushIf(left.domain === right.domain, reasons, "DOMAIN_MISMATCH");
  pushIf(left.family === right.family, reasons, "FAMILY_MISMATCH");
  pushIf(left.competitionKey !== null && right.competitionKey !== null && left.competitionKey === right.competitionKey, reasons, "COMPETITION_CONTEXT_MISMATCH");
  pushIf(left.competitionScope === right.competitionScope, reasons, "COMPETITION_SCOPE_MISMATCH");
  pushIf(left.dateKey !== null && right.dateKey !== null && left.dateKey === right.dateKey, reasons, "DATE_WINDOW_MISMATCH");
  pushIf(left.binaryStructure === right.binaryStructure, reasons, "OUTCOME_STRUCTURE_MISMATCH");
  pushIf(left.outcomeMappingBasis === right.outcomeMappingBasis, reasons, "OUTCOME_STRUCTURE_MISMATCH");

  if (left.family === "MATCHUP_WINNER") {
    pushIf(left.matchupKey !== null && right.matchupKey !== null && left.matchupKey === right.matchupKey, reasons, "SUBJECT_ENTITY_MISMATCH");
    pushIf(left.opponentEntity !== null && right.opponentEntity !== null && left.opponentEntity === right.opponentEntity, reasons, "OPPONENT_MISMATCH");
    pushIf(left.sideAssignment === right.sideAssignment, reasons, "SIDE_ASSIGNMENT_MISMATCH");
  } else {
    pushIf(left.subjectEntity !== null && right.subjectEntity !== null && left.subjectEntity === right.subjectEntity, reasons, "SUBJECT_ENTITY_MISMATCH");
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    ruleIds: [RULE_ID]
  };
};
