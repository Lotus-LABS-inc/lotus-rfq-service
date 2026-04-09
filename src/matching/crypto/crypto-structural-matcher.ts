import type { StructuralMatchResult, StructuralFingerprint } from "../matching-types.js";

const STRUCTURAL_RULE_VERSION = "crypto-structural-matcher-v1";
const EXACT_CUTOFF_TOLERANCE_MS = 5 * 60 * 1000;

export interface CryptoStructuralMatchResult extends StructuralMatchResult {
  mismatchedDimensions: readonly string[];
}

const matchCutoff = (left: unknown, right: unknown): boolean => {
  if (left === null && right === null) return true;
  if (typeof left !== "string" || typeof right !== "string") return false;
  return Math.abs(Date.parse(left) - Date.parse(right)) <= EXACT_CUTOFF_TOLERANCE_MS;
};

const matchDimension = (matched: string[], mismatched: string[], name: string, condition: boolean): void => {
  if (condition) {
    matched.push(name);
    return;
  }
  mismatched.push(name);
};

const matchByFamily = (left: StructuralFingerprint, right: StructuralFingerprint): { matched: readonly string[]; mismatched: readonly string[] } => {
  const matched: string[] = [];
  const mismatched: string[] = [];
  const family = left.fingerprint.family;
  matchDimension(matched, mismatched, "asset", left.fingerprint.asset === right.fingerprint.asset);
  matchDimension(matched, mismatched, "family", family === right.fingerprint.family);
  matchDimension(matched, mismatched, "observationType", left.fingerprint.observationType === right.fingerprint.observationType);
  matchDimension(matched, mismatched, "bucketGranularity", left.fingerprint.bucketGranularity === right.fingerprint.bucketGranularity);
  matchDimension(matched, mismatched, "dateKey", left.fingerprint.dateKey === right.fingerprint.dateKey);
  matchDimension(matched, mismatched, "binaryStructure", left.fingerprint.binaryStructure === right.fingerprint.binaryStructure);
  matchDimension(matched, mismatched, "structuralContractClass", left.fingerprint.structuralContractClass === right.fingerprint.structuralContractClass);

  if (family === "THRESHOLD_BY_DATE") {
    matchDimension(matched, mismatched, "threshold", left.fingerprint.threshold === right.fingerprint.threshold);
    matchDimension(matched, mismatched, "comparator", left.fingerprint.comparator === right.fingerprint.comparator);
    if (left.fingerprint.observationType === "END_OF_PERIOD_CLOSE") {
      matchDimension(matched, mismatched, "cutoffTimestamp", matchCutoff(left.fingerprint.timezoneNormalizedCutoffKey, right.fingerprint.timezoneNormalizedCutoffKey));
    }
  }
  if (family === "ATH_BY_DATE") {
    matchDimension(matched, mismatched, "anyTimeBeforeSemantics", left.fingerprint.observationType === "ANY_TIME_BEFORE" && right.fingerprint.observationType === "ANY_TIME_BEFORE");
  }
  if (family === "SAME_DAY_DIRECTIONAL" || family === "GENERIC_DIRECTIONAL") {
    matchDimension(matched, mismatched, "directionalComparator", left.fingerprint.comparator === right.fingerprint.comparator);
    matchDimension(matched, mismatched, "cutoffTimestamp", matchCutoff(left.fingerprint.timezoneNormalizedCutoffKey, right.fingerprint.timezoneNormalizedCutoffKey));
  }
  if (family === "PRICE_AT_CLOSE") {
    matchDimension(matched, mismatched, "cutoffTimestamp", matchCutoff(left.fingerprint.timezoneNormalizedCutoffKey, right.fingerprint.timezoneNormalizedCutoffKey));
  }
  if (family === "UP_DOWN_BUCKET" || family === "PRICE_RANGE_BUCKET") {
    matchDimension(matched, mismatched, "rangeBucketMetadata", JSON.stringify(left.fingerprint.rangeBucketMetadata) === JSON.stringify(right.fingerprint.rangeBucketMetadata));
  }

  return { matched, mismatched };
};

const isCompatibleForClassifier = (mismatched: readonly string[]): boolean =>
  mismatched.every((dimension) => dimension === "cutoffTimestamp" || dimension === "threshold" || dimension === "comparator");

export const runCryptoStructuralMatcher = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): CryptoStructuralMatchResult => {
  const { matched, mismatched } = matchByFamily(input.leftFingerprint, input.rightFingerprint);
  if (mismatched.length === 0) {
    return {
      outcome: "EXACT",
      reasons: ["crypto_structural_exact"],
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: [STRUCTURAL_RULE_VERSION]
    };
  }
  if (isCompatibleForClassifier(mismatched)) {
    return {
      outcome: "NOT_EXACT_BUT_COMPATIBLE_FOR_CLASSIFIER",
      reasons: mismatched.map((dimension) => `structural:${dimension}_mismatch`),
      matchedDimensions: matched,
      mismatchedDimensions: mismatched,
      ruleIds: [STRUCTURAL_RULE_VERSION, "compatible_for_crypto_classifier"]
    };
  }
  return {
    outcome: "REJECTED",
    reasons: mismatched.map((dimension) => `structural:${dimension}_mismatch`),
    matchedDimensions: matched,
    mismatchedDimensions: mismatched,
    ruleIds: [STRUCTURAL_RULE_VERSION, "structural_rejected"]
  };
};

