import { buildStableTextId, buildStableUuid } from "../../canonical/canonicalization-types.js";
import type { RouteabilityTemporalBasis } from "../../inventory/inventory-basis-classifier.js";
import { buildMatchingProvenance } from "../matching-provenance.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  StructuralFingerprint,
  StructuralMatchResult
} from "../matching-types.js";
import type { MatchingVersionRecord } from "../matching-versioning.js";
import type { ReviewApprovalDecision } from "../review-approval-policy.js";

const orderedContracts = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): [string, string] =>
  leftMarket.interpretedContractId.localeCompare(rightMarket.interpretedContractId) <= 0
    ? [leftMarket.interpretedContractId, rightMarket.interpretedContractId]
    : [rightMarket.interpretedContractId, leftMarket.interpretedContractId];

const orderedVenues = (leftMarket: MatchingMarketRecord, rightMarket: MatchingMarketRecord): [MatchingMarketRecord["venue"], MatchingMarketRecord["venue"]] =>
  leftMarket.venue.localeCompare(rightMarket.venue) <= 0
    ? [leftMarket.venue, rightMarket.venue]
    : [rightMarket.venue, leftMarket.venue];

const buildCanonicalEventId = (leftFingerprint: StructuralFingerprint, rightFingerprint: StructuralFingerprint): string => {
  const left = leftFingerprint.fingerprint;
  const right = rightFingerprint.fingerprint;
  const canonicalKey = [
    left["family"],
    left["jurisdiction"] ?? right["jurisdiction"],
    left["office"] ?? right["office"],
    left["institution"] ?? right["institution"],
    left["cycleYear"] ?? right["cycleYear"],
    left["contestStage"] ?? right["contestStage"],
    left["candidateSetFingerprint"] ?? right["candidateSetFingerprint"],
    left["thresholdSemantics"] ?? right["thresholdSemantics"],
    left["dateBoundarySemantics"] ?? right["dateBoundarySemantics"],
    left["eventType"] ?? right["eventType"]
  ].join("|");
  return buildStableUuid(`politics-pair|${canonicalKey}`);
};

export const buildPoliticsPairEdgeRecord = (input: {
  leftMarket: MatchingMarketRecord;
  rightMarket: MatchingMarketRecord;
  leftFamily: ContractFamilyClassification;
  rightFamily: ContractFamilyClassification;
  leftFingerprint: StructuralFingerprint;
  rightFingerprint: StructuralFingerprint;
  prefilterRuleIds: readonly string[];
  structuralMatch: StructuralMatchResult;
  approvalDecision: ReviewApprovalDecision;
  temporalBasis: RouteabilityTemporalBasis;
  matchingVersion: MatchingVersionRecord;
  compatibilityDecisionId: string | null;
  compatibilityClass: string | null;
}): PairEdgeRecord => {
  const [interpretedContractAId, interpretedContractBId] = orderedContracts(input.leftMarket, input.rightMarket);
  const [leftVenue, rightVenue] = orderedVenues(input.leftMarket, input.rightMarket);
  const canonicalEventId = buildCanonicalEventId(input.leftFingerprint, input.rightFingerprint);
  const label: PairEdgeRecord["label"] = input.structuralMatch.outcome === "EXACT" ? "EXACT" : "DIFFERENT";

  return {
    id: buildStableTextId(
      "politicsedge_",
      `${canonicalEventId}|${interpretedContractAId}|${interpretedContractBId}|${input.matchingVersion.id}`
    ),
    canonicalEventId,
    interpretedContractAId,
    interpretedContractBId,
    leftVenue,
    rightVenue,
    family: input.leftFamily.family,
    label,
    confidenceScore: input.structuralMatch.outcome === "EXACT" ? "1" : "0",
    approvalState: input.approvalDecision.approvalState,
    reasons: [...input.structuralMatch.reasons],
    rejectionReasons: label === "EXACT" ? [] : [...input.structuralMatch.reasons],
    temporalBasis: input.temporalBasis,
    compatibilityDecisionId: input.compatibilityDecisionId,
    compatibilityClass: input.compatibilityClass,
    matchingVersionId: input.matchingVersion.id,
    provenance: buildMatchingProvenance({
      familyClassifierRuleIds: [...input.leftFamily.ruleIds, ...input.rightFamily.ruleIds],
      fingerprintRuleIds: [input.leftFingerprint.fingerprintVersion, input.rightFingerprint.fingerprintVersion],
      prefilterRuleIds: [...input.prefilterRuleIds],
      structuralRuleIds: [...input.structuralMatch.ruleIds],
      classifierRuleIds: [],
      embeddingRuleIds: ["politics-embeddings-disabled-v1"],
      temporalBasis: input.temporalBasis,
      replay: {
        replayReference: null,
        deterministicInputHash: buildStableTextId(
          "politicspairhash_",
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
