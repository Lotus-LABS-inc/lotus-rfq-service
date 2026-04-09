import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import type { PairClassifierDimensionScores, PairClassifierResult, StructuralFingerprint } from "../matching-types.js";

export interface SportsPairClassifierResult extends PairClassifierResult {
  reviewRequired: boolean;
}

const MODEL_VERSION = "sports-pair-classifier-v1";

const score = (value: number): string =>
  Math.max(0, Math.min(1, value)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

const buildScores = (left: StructuralFingerprint, right: StructuralFingerprint): PairClassifierDimensionScores => ({
  familyConsistency: score(left.fingerprint.family === right.fingerprint.family ? 1 : 0),
  timeBoundaryConsistency: score(
    left.fingerprint.dateKey === right.fingerprint.dateKey
      ? left.fingerprint.scheduledBoundaryKey === right.fingerprint.scheduledBoundaryKey ? 1 : 0.75
      : 0
  ),
  thresholdComparatorConsistency: "1",
  outcomeStructureConsistency: score(
    left.fingerprint.binaryStructure === right.fingerprint.binaryStructure
      && left.fingerprint.outcomeMappingBasis === right.fingerprint.outcomeMappingBasis ? 1 : 0
  ),
  competitionSubjectConsistency: score(
    left.fingerprint.competitionKey === right.fingerprint.competitionKey
      && (
        (left.fingerprint.matchupKey !== null && left.fingerprint.matchupKey === right.fingerprint.matchupKey)
        || (left.fingerprint.subjectEntity !== null && left.fingerprint.subjectEntity === right.fingerprint.subjectEntity)
      ) ? 1 : 0
  ),
  resolutionCompatibilityHints: score(left.fingerprint.competitionScope === right.fingerprint.competitionScope ? 1 : 0),
  settlementCompatibilityHints: "1",
  temporalBasisCompatibilityHints: "1"
});

const averageScore = (scores: PairClassifierDimensionScores): number =>
  Object.values(scores).map((value) => Number.parseFloat(value)).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length;

const decideLabel = (value: number): SportsPairClassifierResult["finalLabel"] =>
  value >= 0.98 ? "EXACT"
  : value >= 0.87 ? "EQUIVALENT"
  : value >= 0.55 ? "SIMILAR"
  : "DIFFERENT";

const decideRecommendation = (label: SportsPairClassifierResult["finalLabel"], confidence: number): SportsPairClassifierResult["policyRecommendation"] =>
  label === "EXACT" && confidence >= 0.995 ? "AUTO_APPROVE"
  : label === "DIFFERENT" ? "REJECT"
  : "REVIEW";

export const classifySportsPair = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): SportsPairClassifierResult => {
  const dimensionScores = buildScores(input.leftFingerprint, input.rightFingerprint);
  const confidence = averageScore(dimensionScores);
  const finalLabel = decideLabel(confidence);
  const policyRecommendation = decideRecommendation(finalLabel, confidence);

  return {
    finalLabel,
    confidenceScore: score(confidence),
    reasons: [
      `domain:${String(input.leftFingerprint.fingerprint.domain ?? "unknown").toLowerCase()}`,
      `family:${String(input.leftFingerprint.fingerprint.family ?? "unknown").toLowerCase()}`,
      `confidence:${score(confidence)}`
    ],
    dimensionScores,
    policyRecommendation,
    ambiguityFlags: [],
    modelVersion: MODEL_VERSION,
    promptVersion: "deterministic-heuristic-v1",
    replayMetadata: {
      replayKey: buildStableTextId(
        "sportsclf_",
        `${input.leftFingerprint.interpretedContractId}|${input.rightFingerprint.interpretedContractId}|${score(confidence)}`
      )
    },
    reviewRequired: policyRecommendation !== "AUTO_APPROVE"
  };
};
