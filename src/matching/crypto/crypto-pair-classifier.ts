import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import type { PairClassifierDimensionScores, PairClassifierResult, StructuralFingerprint } from "../matching-types.js";

export interface CryptoPairClassifierResult extends PairClassifierResult {
  reviewRequired: boolean;
}

const MODEL_VERSION = "crypto-pair-classifier-v1";

const score = (value: number): string =>
  Math.max(0, Math.min(1, value)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

const buildScores = (left: StructuralFingerprint, right: StructuralFingerprint): PairClassifierDimensionScores => ({
  familyConsistency: score(left.fingerprint.family === right.fingerprint.family ? 1 : 0),
  timeBoundaryConsistency: score(left.fingerprint.dateKey === right.fingerprint.dateKey ? (left.fingerprint.timezoneNormalizedCutoffKey === right.fingerprint.timezoneNormalizedCutoffKey ? 1 : 0.75) : 0),
  thresholdComparatorConsistency: score(
    left.fingerprint.threshold === right.fingerprint.threshold && left.fingerprint.comparator === right.fingerprint.comparator ? 1
    : left.fingerprint.comparator === right.fingerprint.comparator ? 0.6
    : 0
  ),
  outcomeStructureConsistency: score(left.fingerprint.binaryStructure === right.fingerprint.binaryStructure ? 1 : 0),
  competitionSubjectConsistency: score(left.fingerprint.asset === right.fingerprint.asset ? 1 : 0),
  resolutionCompatibilityHints: score(left.fingerprint.structuralContractClass === right.fingerprint.structuralContractClass ? 1 : 0),
  settlementCompatibilityHints: score(left.fingerprint.observationType === right.fingerprint.observationType ? 1 : 0),
  temporalBasisCompatibilityHints: "1"
});

const averageScore = (scores: PairClassifierDimensionScores): number =>
  Object.values(scores).map((value) => Number.parseFloat(value)).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length;

const decideLabel = (value: number): CryptoPairClassifierResult["finalLabel"] =>
  value >= 0.97 ? "EXACT"
  : value >= 0.84 ? "EQUIVALENT"
  : value >= 0.55 ? "SIMILAR"
  : "DIFFERENT";

const decideRecommendation = (label: CryptoPairClassifierResult["finalLabel"], confidence: number): CryptoPairClassifierResult["policyRecommendation"] =>
  label === "EXACT" && confidence >= 0.995 ? "AUTO_APPROVE"
  : label === "DIFFERENT" ? "REJECT"
  : "REVIEW";

export const classifyCryptoPair = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): CryptoPairClassifierResult => {
  const dimensionScores = buildScores(input.leftFingerprint, input.rightFingerprint);
  const confidence = averageScore(dimensionScores);
  const finalLabel = decideLabel(confidence);
  const policyRecommendation = decideRecommendation(finalLabel, confidence);

  return {
    finalLabel,
    confidenceScore: score(confidence),
    reasons: [
      `asset:${String(input.leftFingerprint.fingerprint.asset ?? "unknown").toLowerCase()}`,
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
        "cryptoclf_",
        `${input.leftFingerprint.interpretedContractId}|${input.rightFingerprint.interpretedContractId}|${score(confidence)}`
      )
    },
    reviewRequired: policyRecommendation !== "AUTO_APPROVE"
  };
};

