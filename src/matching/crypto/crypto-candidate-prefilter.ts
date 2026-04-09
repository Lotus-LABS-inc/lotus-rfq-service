import type { CandidatePrefilterResult, StructuralFingerprint } from "../matching-types.js";
import type { CryptoComparator, CryptoPrefilterRejectionReason } from "./crypto-match-labels.js";

const PREFILTER_RULE_ID = "crypto-candidate-prefilter-v1";
const PREFILTER_CUTOFF_TOLERANCE_MS = 60 * 60 * 1000;

const pushReason = (
  reasons: CryptoPrefilterRejectionReason[],
  condition: boolean,
  reason: CryptoPrefilterRejectionReason
): void => {
  if (!condition) {
    reasons.push(reason);
  }
};

const comparatorFamily = (comparator: CryptoComparator | null): string | null =>
  comparator === "ABOVE" || comparator === "AT_OR_ABOVE" ? "ABOVE_FAMILY"
  : comparator === "BELOW" || comparator === "AT_OR_BELOW" ? "BELOW_FAMILY"
  : comparator === "UP" || comparator === "DOWN" || comparator === "YES_NO_DIRECTIONAL" ? "DIRECTIONAL_FAMILY"
  : null;

const datesCompatible = (leftDateKey: unknown, rightDateKey: unknown): boolean =>
  typeof leftDateKey === "string" && typeof rightDateKey === "string" && leftDateKey === rightDateKey;

const cutoffsCompatible = (leftCutoff: unknown, rightCutoff: unknown): boolean => {
  if (leftCutoff === null || rightCutoff === null) {
    return true;
  }
  if (typeof leftCutoff !== "string" || typeof rightCutoff !== "string") {
    return false;
  }
  return Math.abs(Date.parse(leftCutoff) - Date.parse(rightCutoff)) <= PREFILTER_CUTOFF_TOLERANCE_MS;
};

export const prefilterCryptoCandidatePair = (input: {
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): CandidatePrefilterResult => {
  const left = input.leftFingerprint.fingerprint;
  const right = input.rightFingerprint.fingerprint;
  const reasons: CryptoPrefilterRejectionReason[] = [];

  pushReason(reasons, left.asset === right.asset, "ASSET_MISMATCH");
  pushReason(reasons, left.family === right.family, "FAMILY_MISMATCH");
  pushReason(reasons, left.observationType === right.observationType, "OBSERVATION_TYPE_MISMATCH");
  pushReason(reasons, left.bucketGranularity === right.bucketGranularity, "BUCKET_GRANULARITY_MISMATCH");
  pushReason(
    reasons,
    comparatorFamily((left.comparator ?? null) as CryptoComparator | null) === comparatorFamily((right.comparator ?? null) as CryptoComparator | null),
    "COMPARATOR_MISMATCH"
  );
  pushReason(reasons, datesCompatible(left.dateKey, right.dateKey), "DATE_BOUNDARY_MISMATCH");
  pushReason(reasons, cutoffsCompatible(left.timezoneNormalizedCutoffKey, right.timezoneNormalizedCutoffKey), "CUTOFF_MISMATCH");
  pushReason(reasons, left.structuralContractClass === right.structuralContractClass, "THRESHOLD_STRUCTURE_MISMATCH");

  return {
    accepted: reasons.length === 0,
    reasons,
    ruleIds: [PREFILTER_RULE_ID]
  };
};

