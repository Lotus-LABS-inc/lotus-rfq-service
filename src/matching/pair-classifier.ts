import { buildStableTextId } from "../canonical/canonicalization-types.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairClassifierDimensionScores,
  PairClassifierResult,
  StructuralFingerprint
} from "./matching-types.js";

export interface PairClassifier {
  classify(input: {
    leftMarket: MatchingMarketRecord;
    rightMarket: MatchingMarketRecord;
    leftFamily: ContractFamilyClassification;
    rightFamily: ContractFamilyClassification;
    leftFingerprint: StructuralFingerprint;
    rightFingerprint: StructuralFingerprint;
  }): PairClassifierResult;
}

const toScore = (matched: boolean, partial = false): string => matched ? "1" : partial ? "0.5" : "0";

const buildDimensionScores = (input: {
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
}): PairClassifierDimensionScores => ({
  familyConsistency: toScore(input.leftFamily.family === input.rightFamily.family),
  timeBoundaryConsistency: toScore(input.leftFingerprint.fingerprint.date === input.rightFingerprint.fingerprint.date, true),
  thresholdComparatorConsistency: toScore(
    input.leftFingerprint.fingerprint.threshold === input.rightFingerprint.fingerprint.threshold
      && input.leftFingerprint.fingerprint.comparator === input.rightFingerprint.fingerprint.comparator,
    input.leftFingerprint.fingerprint.comparator === input.rightFingerprint.fingerprint.comparator
  ),
  outcomeStructureConsistency: toScore(input.leftMarket.marketClass === input.rightMarket.marketClass),
  competitionSubjectConsistency: toScore(
    input.leftFingerprint.fingerprint.subject === input.rightFingerprint.fingerprint.subject
      || input.leftFingerprint.fingerprint.competitionOrContext === input.rightFingerprint.fingerprint.competitionOrContext,
    true
  ),
  resolutionCompatibilityHints: toScore(
    JSON.stringify(input.leftMarket.resolutionSemantics) === JSON.stringify(input.rightMarket.resolutionSemantics),
    true
  ),
  settlementCompatibilityHints: toScore(
    JSON.stringify(input.leftMarket.settlementSemantics) === JSON.stringify(input.rightMarket.settlementSemantics),
    true
  ),
  temporalBasisCompatibilityHints: toScore(input.leftMarket.inventoryTemporalBasis === input.rightMarket.inventoryTemporalBasis, true)
});

const scoreAverage = (scores: PairClassifierDimensionScores): number => {
  const values = Object.values(scores).map((value) => Number.parseFloat(value));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const decideLabel = (score: number): PairClassifierResult["finalLabel"] =>
  score >= 0.92 ? "EXACT"
  : score >= 0.78 ? "EQUIVALENT"
  : score >= 0.45 ? "SIMILAR"
  : "DIFFERENT";

const decideRecommendation = (
  label: PairClassifierResult["finalLabel"],
  score: number
): PairClassifierResult["policyRecommendation"] =>
  label === "EXACT" && score >= 0.96 ? "AUTO_APPROVE"
  : label === "DIFFERENT" ? "REJECT"
  : "REVIEW";

export class OfflineHeuristicPairClassifier implements PairClassifier {
  public classify(input: {
    leftMarket: MatchingMarketRecord;
    rightMarket: MatchingMarketRecord;
    leftFamily: ContractFamilyClassification;
    rightFamily: ContractFamilyClassification;
    leftFingerprint: StructuralFingerprint;
    rightFingerprint: StructuralFingerprint;
  }): PairClassifierResult {
    const dimensionScores = buildDimensionScores(input);
    const score = scoreAverage(dimensionScores);
    const finalLabel = decideLabel(score);
    const policyRecommendation = decideRecommendation(finalLabel, score);
    const ambiguityFlags = [
      ...input.leftFamily.ambiguityFlags,
      ...input.rightFamily.ambiguityFlags
    ];

    return {
      finalLabel,
      confidenceScore: score.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
      reasons: [
        `family:${input.leftFamily.family}`,
        `score:${score.toFixed(3)}`,
        `recommendation:${policyRecommendation.toLowerCase()}`
      ],
      dimensionScores,
      policyRecommendation,
      ambiguityFlags,
      modelVersion: "offline-heuristic-pair-classifier-v1",
      promptVersion: "offline-heuristic-eval-v1",
      replayMetadata: {
        replayKey: buildStableTextId(
          "pairclf_",
          `${input.leftMarket.interpretedContractId}|${input.rightMarket.interpretedContractId}|${score.toFixed(6)}`
        )
      }
    };
  }
}
