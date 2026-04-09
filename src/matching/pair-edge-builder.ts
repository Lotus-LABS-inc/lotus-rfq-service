import { buildStableTextId } from "../canonical/canonicalization-types.js";
import type { RouteabilityTemporalBasis } from "../inventory/inventory-basis-classifier.js";
import { buildMatchingProvenance } from "./matching-provenance.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairClassifierResult,
  PairEdgeRecord,
  StructuralMatchResult
} from "./matching-types.js";
import type { MatchingVersionRecord } from "./matching-versioning.js";
import type { ReviewApprovalDecision } from "./review-approval-policy.js";

export const buildPairEdgeRecord = (input: {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  structuralMatch: StructuralMatchResult;
  classifierResult: PairClassifierResult | null;
  approvalDecision: ReviewApprovalDecision;
  temporalBasis: RouteabilityTemporalBasis;
  matchingVersion: MatchingVersionRecord;
  compatibilityDecisionId: string | null;
  compatibilityClass: string | null;
}): PairEdgeRecord => {
  const leftId = input.leftMarket.interpretedContractId.localeCompare(input.rightMarket.interpretedContractId) <= 0
    ? input.leftMarket.interpretedContractId
    : input.rightMarket.interpretedContractId;
  const rightId = leftId === input.leftMarket.interpretedContractId
    ? input.rightMarket.interpretedContractId
    : input.leftMarket.interpretedContractId;
  const label =
    input.structuralMatch.outcome === "EXACT" ? "EXACT"
    : input.structuralMatch.outcome === "REJECTED" ? "DIFFERENT"
    : input.classifierResult?.finalLabel ?? "DIFFERENT";
  const confidenceScore =
    input.structuralMatch.outcome === "EXACT" ? "1"
    : input.classifierResult?.confidenceScore ?? "0";

  return {
    id: buildStableTextId(
      "pairedge_",
      `${input.leftMarket.canonicalEventId}|${leftId}|${rightId}|${input.matchingVersion.id}`
    ),
    canonicalEventId: input.leftMarket.canonicalEventId,
    interpretedContractAId: leftId,
    interpretedContractBId: rightId,
    leftVenue: input.leftMarket.venue.localeCompare(input.rightMarket.venue) <= 0 ? input.leftMarket.venue : input.rightMarket.venue,
    rightVenue: input.leftMarket.venue.localeCompare(input.rightMarket.venue) <= 0 ? input.rightMarket.venue : input.leftMarket.venue,
    family: input.leftFamily.family,
    label,
    confidenceScore,
    approvalState: input.approvalDecision.approvalState,
    reasons: [
      ...input.structuralMatch.reasons,
      ...(input.classifierResult?.reasons ?? [])
    ],
    rejectionReasons: input.structuralMatch.outcome === "REJECTED"
      || label === "DIFFERENT"
      || label === "SIMILAR"
      ? [...input.structuralMatch.reasons, ...(input.classifierResult?.reasons ?? [])]
      : [],
    temporalBasis: input.temporalBasis,
    compatibilityDecisionId: input.compatibilityDecisionId,
    compatibilityClass: input.compatibilityClass,
    matchingVersionId: input.matchingVersion.id,
    provenance: buildMatchingProvenance({
      familyClassifierRuleIds: [...input.leftFamily.ruleIds, ...input.rightFamily.ruleIds],
      fingerprintRuleIds: ["structural-fingerprint-v1"],
      prefilterRuleIds: [],
      structuralRuleIds: input.structuralMatch.ruleIds,
      classifierRuleIds: input.classifierResult ? [input.classifierResult.modelVersion, input.classifierResult.promptVersion] : [],
      embeddingRuleIds: [],
      temporalBasis: input.temporalBasis,
      replay: {
        replayReference: input.classifierResult?.replayMetadata["replayKey"] as string | null ?? null,
        deterministicInputHash: buildStableTextId(
          "pairhash_",
          `${leftId}|${rightId}|${label}|${input.temporalBasis}`
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
