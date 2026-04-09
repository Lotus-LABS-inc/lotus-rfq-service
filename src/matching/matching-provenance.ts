import type { RouteabilityTemporalBasis } from "../inventory/inventory-basis-classifier.js";

export interface MatchingReplayMetadata {
  replayReference: string | null;
  deterministicInputHash: string;
  evaluationVersion: string;
}

export interface MatchingProvenance {
  familyClassifierRuleIds: readonly string[];
  fingerprintRuleIds: readonly string[];
  prefilterRuleIds: readonly string[];
  structuralRuleIds: readonly string[];
  classifierRuleIds: readonly string[];
  embeddingRuleIds: readonly string[];
  temporalBasis: RouteabilityTemporalBasis;
  replay: MatchingReplayMetadata;
}

export const buildMatchingProvenance = (input: MatchingProvenance): MatchingProvenance => ({
  familyClassifierRuleIds: [...input.familyClassifierRuleIds],
  fingerprintRuleIds: [...input.fingerprintRuleIds],
  prefilterRuleIds: [...input.prefilterRuleIds],
  structuralRuleIds: [...input.structuralRuleIds],
  classifierRuleIds: [...input.classifierRuleIds],
  embeddingRuleIds: [...input.embeddingRuleIds],
  temporalBasis: input.temporalBasis,
  replay: { ...input.replay }
});
