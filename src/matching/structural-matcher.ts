import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  StructuralFingerprint,
  StructuralMatchResult
} from "./matching-types.js";

const asString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const exactDimensionsForCrypto = (left: StructuralFingerprint, right: StructuralFingerprint): readonly string[] => {
  const matched: string[] = [];
  if (left.fingerprint.asset === right.fingerprint.asset) matched.push("asset");
  if (left.fingerprint.family === right.fingerprint.family) matched.push("family");
  if (left.fingerprint.threshold === right.fingerprint.threshold) matched.push("threshold");
  if (left.fingerprint.comparator === right.fingerprint.comparator) matched.push("comparator");
  if (left.fingerprint.date === right.fingerprint.date) matched.push("date");
  if (left.fingerprint.observationType === right.fingerprint.observationType) matched.push("observationType");
  if (left.fingerprint.binaryStructure === right.fingerprint.binaryStructure) matched.push("binaryStructure");
  return matched;
};

const exactDimensionsForSports = (left: StructuralFingerprint, right: StructuralFingerprint): readonly string[] => {
  const matched: string[] = [];
  if (left.fingerprint.family === right.fingerprint.family) matched.push("family");
  if (left.fingerprint.competitionOrContext === right.fingerprint.competitionOrContext) matched.push("competitionOrContext");
  if (left.fingerprint.subjectEntities?.toString() === right.fingerprint.subjectEntities?.toString()) matched.push("subjectEntities");
  if (left.fingerprint.date === right.fingerprint.date) matched.push("date");
  if (left.fingerprint.winnerSemantics === right.fingerprint.winnerSemantics) matched.push("winnerSemantics");
  return matched;
};

const exactDimensionsForEvents = (left: StructuralFingerprint, right: StructuralFingerprint): readonly string[] => {
  const matched: string[] = [];
  if (left.fingerprint.family === right.fingerprint.family) matched.push("family");
  if (left.fingerprint.subject === right.fingerprint.subject) matched.push("subject");
  if (left.fingerprint.comparator === right.fingerprint.comparator) matched.push("comparator");
  if (left.fingerprint.date === right.fingerprint.date) matched.push("date");
  return matched;
};

const requiredMatchCount = (market: MatchingMarketRecord, family: ContractFamilyClassification): number =>
  market.category === "CRYPTO" ? 7
  : market.category === "SPORTS" || market.category === "ESPORTS" ? 5
  : family.weakStructureLane ? 3 : 4;

const buildCompatibleReasons = (left: StructuralFingerprint, right: StructuralFingerprint): readonly string[] => {
  const reasons: string[] = [];
  if (asString(left.fingerprint.threshold) !== asString(right.fingerprint.threshold)) reasons.push("threshold_mismatch");
  if (asString(left.fingerprint.date) !== asString(right.fingerprint.date)) reasons.push("date_window_mismatch");
  if (asString(left.fingerprint.comparator) !== asString(right.fingerprint.comparator)) reasons.push("comparator_mismatch");
  return reasons;
};

export const runStructuralMatcher = (input: {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): StructuralMatchResult => {
  const matchedDimensions =
    input.leftMarket.category === "CRYPTO" ? exactDimensionsForCrypto(input.leftFingerprint, input.rightFingerprint)
    : input.leftMarket.category === "SPORTS" || input.leftMarket.category === "ESPORTS" ? exactDimensionsForSports(input.leftFingerprint, input.rightFingerprint)
    : exactDimensionsForEvents(input.leftFingerprint, input.rightFingerprint);
  const required = requiredMatchCount(input.leftMarket, input.leftFamily);
  if (matchedDimensions.length >= required) {
    return {
      outcome: "EXACT",
      reasons: ["structural_exact"],
      matchedDimensions,
      ruleIds: ["structural-matcher:exact-v1"]
    };
  }

  const compatibleReasons = buildCompatibleReasons(input.leftFingerprint, input.rightFingerprint);
  if (input.leftFamily.family === input.rightFamily.family && matchedDimensions.length >= Math.max(2, required - 2)) {
    return {
      outcome: "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER",
      reasons: compatibleReasons.length > 0 ? compatibleReasons : ["structural_partial_overlap"],
      matchedDimensions,
      ruleIds: ["structural-matcher:classifier-lane-v1"]
    };
  }

  return {
    outcome: "REJECTED",
    reasons: compatibleReasons.length > 0 ? compatibleReasons : ["structural_mismatch"],
    matchedDimensions,
    ruleIds: ["structural-matcher:rejected-v1"]
  };
};
