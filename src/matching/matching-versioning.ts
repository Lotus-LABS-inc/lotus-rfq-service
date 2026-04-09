import { buildStableTextId } from "../canonical/canonicalization-types.js";

export interface MatchingVersionDescriptor {
  familyClassifierVersion: string;
  fingerprintVersion: string;
  prefilterVersion: string;
  structuralMatcherVersion: string;
  pairClassifierVersion: string;
  embeddingModelVersion: string;
  reviewPolicyVersion: string;
}

export interface MatchingVersionRecord extends MatchingVersionDescriptor {
  id: string;
}

export const DEFAULT_MATCHING_VERSION_DESCRIPTOR: MatchingVersionDescriptor = {
  familyClassifierVersion: "contract-family-classifier-v1",
  fingerprintVersion: "structural-fingerprint-v1",
  prefilterVersion: "candidate-prefilter-v1",
  structuralMatcherVersion: "structural-matcher-v1",
  pairClassifierVersion: "offline-heuristic-pair-classifier-v1",
  embeddingModelVersion: "token-jaccard-shortlist-v1",
  reviewPolicyVersion: "pair-review-policy-v1"
};

export const buildMatchingVersionRecord = (
  descriptor: MatchingVersionDescriptor = DEFAULT_MATCHING_VERSION_DESCRIPTOR
): MatchingVersionRecord => ({
  ...descriptor,
  id: buildStableTextId(
    "pairmatchver_",
    [
      descriptor.familyClassifierVersion,
      descriptor.fingerprintVersion,
      descriptor.prefilterVersion,
      descriptor.structuralMatcherVersion,
      descriptor.pairClassifierVersion,
      descriptor.embeddingModelVersion,
      descriptor.reviewPolicyVersion
    ].join("|")
  )
});
