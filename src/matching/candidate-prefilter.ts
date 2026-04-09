import type {
  CandidatePrefilterResult,
  ContractFamilyClassification,
  MatchingMarketRecord,
  StructuralFingerprint
} from "./matching-types.js";

const matchesComparator = (left: unknown, right: unknown): boolean =>
  left === right || left === null || right === null;

const matchesDateWindow = (left: unknown, right: unknown): boolean =>
  left === right || left === null || right === null;

const pushReason = (accepted: boolean, reasons: string[], reason: string): boolean => {
  if (!accepted) {
    reasons.push(reason);
  }
  return accepted;
};

const cryptoPrefilter = (
  leftFingerprint: StructuralFingerprint,
  rightFingerprint: StructuralFingerprint
): CandidatePrefilterResult => {
  const left = leftFingerprint.fingerprint;
  const right = rightFingerprint.fingerprint;
  const reasons: string[] = [];
  const accepted = [
    pushReason(left.asset === right.asset, reasons, "ASSET_MISMATCH"),
    pushReason(left.family === right.family, reasons, "FAMILY_MISMATCH"),
    pushReason(left.observationType === right.observationType || left.observationType === null || right.observationType === null, reasons, "OBSERVATION_TYPE_MISMATCH"),
    pushReason(left.bucketGranularity === right.bucketGranularity || left.bucketGranularity === null || right.bucketGranularity === null, reasons, "STRUCTURE_MISMATCH"),
    pushReason(matchesDateWindow(left.date, right.date), reasons, "DATE_WINDOW_MISMATCH"),
    pushReason(matchesComparator(left.comparator, right.comparator), reasons, "STRUCTURE_MISMATCH")
  ].every(Boolean);

  return {
    accepted,
    reasons,
    ruleIds: ["prefilter:crypto-v1"]
  };
};

const sportsPrefilter = (
  leftFingerprint: StructuralFingerprint,
  rightFingerprint: StructuralFingerprint
): CandidatePrefilterResult => {
  const left = leftFingerprint.fingerprint;
  const right = rightFingerprint.fingerprint;
  const reasons: string[] = [];
  const accepted = [
    pushReason(left.family === right.family, reasons, "FAMILY_MISMATCH"),
    pushReason(left.competitionOrContext === right.competitionOrContext || left.competitionOrContext === null || right.competitionOrContext === null, reasons, "COMPETITION_MISMATCH"),
    pushReason(left.winnerSemantics === right.winnerSemantics || left.winnerSemantics === null || right.winnerSemantics === null, reasons, "STRUCTURE_MISMATCH")
  ].every(Boolean);

  return {
    accepted,
    reasons,
    ruleIds: ["prefilter:sports-v1"]
  };
};

const eventPrefilter = (
  leftMarket: MatchingMarketRecord,
  rightMarket: MatchingMarketRecord,
  leftFingerprint: StructuralFingerprint,
  rightFingerprint: StructuralFingerprint
): CandidatePrefilterResult => {
  const reasons: string[] = [];
  const accepted = [
    pushReason(leftMarket.category === rightMarket.category, reasons, "FAMILY_MISMATCH"),
    pushReason(leftFingerprint.fingerprint.family === rightFingerprint.fingerprint.family, reasons, "FAMILY_MISMATCH"),
    pushReason(
      leftFingerprint.fingerprint.date === rightFingerprint.fingerprint.date
      || leftFingerprint.fingerprint.date === null
      || rightFingerprint.fingerprint.date === null,
      reasons,
      "DATE_WINDOW_MISMATCH"
    )
  ].every(Boolean);

  return {
    accepted,
    reasons,
    ruleIds: ["prefilter:event-v1"]
  };
};

export const prefilterCandidatePair = (input: {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
}): CandidatePrefilterResult => {
  if (input.leftMarket.venue === input.rightMarket.venue) {
    return {
      accepted: false,
      reasons: ["STRUCTURE_MISMATCH"],
      ruleIds: ["prefilter:no-same-venue"]
    };
  }
  if (input.leftFamily.family !== input.rightFamily.family) {
    return {
      accepted: false,
      reasons: ["FAMILY_MISMATCH"],
      ruleIds: ["prefilter:family-gate"]
    };
  }

  return input.leftMarket.category === "CRYPTO" ? cryptoPrefilter(input.leftFingerprint, input.rightFingerprint)
    : input.leftMarket.category === "SPORTS" || input.leftMarket.category === "ESPORTS" ? sportsPrefilter(input.leftFingerprint, input.rightFingerprint)
    : eventPrefilter(input.leftMarket, input.rightMarket, input.leftFingerprint, input.rightFingerprint);
};
