import { buildStableTextId, buildStableUuid } from "../../canonical/canonicalization-types.js";
import type { RouteabilityTemporalBasis } from "../../inventory/inventory-basis-classifier.js";
import { buildMatchingProvenance } from "../matching-provenance.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  StructuralFingerprint
} from "../matching-types.js";
import type { MatchingVersionRecord } from "../matching-versioning.js";
import type { ReviewApprovalDecision } from "../review-approval-policy.js";
import type { CryptoPairClassifierResult } from "./crypto-pair-classifier.js";
import type { CryptoStructuralMatchResult } from "./crypto-structural-matcher.js";

const toOrderedContracts = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): [string, string] =>
  leftMarket.interpretedContractId.localeCompare(rightMarket.interpretedContractId) <= 0
    ? [leftMarket.interpretedContractId, rightMarket.interpretedContractId]
    : [rightMarket.interpretedContractId, leftMarket.interpretedContractId];

const toOrderedVenues = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): [MatchingMarketRecord["venue"], MatchingMarketRecord["venue"]] =>
  leftMarket.venue.localeCompare(rightMarket.venue) <= 0
    ? [leftMarket.venue, rightMarket.venue]
    : [rightMarket.venue, leftMarket.venue];

const buildCanonicalEventId = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): string => {
  const leftId = leftMarket.canonicalEventId;
  const rightId = rightMarket.canonicalEventId;
  if (leftId === rightId) {
    return leftId;
  }
  return buildStableUuid(
    `crypto-pair|${[leftId, rightId].sort((left, right) => left.localeCompare(right)).join("|")}`
  );
};

const resolveLabel = (
  structuralMatch: CryptoStructuralMatchResult,
  classifierResult: CryptoPairClassifierResult | null
): PairEdgeRecord["label"] =>
  structuralMatch.outcome === "EXACT" ? "EXACT"
  : structuralMatch.outcome === "REJECTED" ? "DIFFERENT"
  : classifierResult?.finalLabel ?? "DIFFERENT";

export const buildCryptoPairEdgeRecord = (input: {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  prefilterRuleIds: readonly string[];
  structuralMatch: CryptoStructuralMatchResult;
  classifierResult: CryptoPairClassifierResult | null;
  approvalDecision: ReviewApprovalDecision;
  temporalBasis: RouteabilityTemporalBasis;
  matchingVersion: MatchingVersionRecord;
  compatibilityDecisionId: string | null;
  compatibilityClass: string | null;
}): PairEdgeRecord => {
  const [interpretedContractAId, interpretedContractBId] = toOrderedContracts(input.leftMarket, input.rightMarket);
  const [leftVenue, rightVenue] = toOrderedVenues(input.leftMarket, input.rightMarket);
  const canonicalEventId = buildCanonicalEventId(input.leftMarket, input.rightMarket);
  const label = resolveLabel(input.structuralMatch, input.classifierResult);

  return {
    id: buildStableTextId(
      "cryptoedge_",
      `${canonicalEventId}|${interpretedContractAId}|${interpretedContractBId}|${input.matchingVersion.id}`
    ),
    canonicalEventId,
    interpretedContractAId,
    interpretedContractBId,
    leftVenue,
    rightVenue,
    family: input.leftFamily.family,
    label,
    confidenceScore: input.structuralMatch.outcome === "EXACT" ? "1" : input.classifierResult?.confidenceScore ?? "0",
    approvalState: input.approvalDecision.approvalState,
    reasons: [
      ...input.structuralMatch.reasons,
      ...(input.classifierResult?.reasons ?? [])
    ],
    rejectionReasons: label === "EXACT" ? [] : [
      ...input.structuralMatch.reasons,
      ...(input.classifierResult?.reasons ?? [])
    ],
    temporalBasis: input.temporalBasis,
    compatibilityDecisionId: input.compatibilityDecisionId,
    compatibilityClass: input.compatibilityClass,
    matchingVersionId: input.matchingVersion.id,
    provenance: buildMatchingProvenance({
      familyClassifierRuleIds: [...input.leftFamily.ruleIds, ...input.rightFamily.ruleIds],
      fingerprintRuleIds: [input.leftFingerprint.fingerprintVersion, input.rightFingerprint.fingerprintVersion],
      prefilterRuleIds: [...input.prefilterRuleIds],
      structuralRuleIds: [...input.structuralMatch.ruleIds],
      classifierRuleIds: input.classifierResult ? [input.classifierResult.modelVersion, input.classifierResult.promptVersion] : [],
      embeddingRuleIds: ["crypto-embeddings-disabled-v1"],
      temporalBasis: input.temporalBasis,
      replay: {
        replayReference: input.classifierResult?.replayMetadata["replayKey"] as string | null ?? null,
        deterministicInputHash: buildStableTextId(
          "cryptopairhash_",
          `${input.leftFingerprint.fingerprintHash}|${input.rightFingerprint.fingerprintHash}|${label}|${input.matchingVersion.id}`
        ),
        evaluationVersion: input.matchingVersion.id
      }
    }),
    computedAt: new Date(),
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: input.approvalDecision.reviewReason
  };
};

