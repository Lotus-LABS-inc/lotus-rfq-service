import type { CompatibilityClass } from "./canonicalization-types.js";
import type { SemanticsRulepackValidation } from "./semantics-rulepack-validator.js";
import type { SemanticsRulepackProvenance } from "./semantics-rulepack-versioning.js";

export interface SemanticsRulepackMetricsSample {
  validation: SemanticsRulepackValidation;
  provenance: SemanticsRulepackProvenance;
  compatibilityDecisionClass?: CompatibilityClass | null;
}

export interface SemanticsRulepackMetricsSummary {
  semantic_candidate_matches_total: number;
  semantic_rules_fired_total: number;
  semantic_confidence_uplift_total: number;
  semantic_match_downgraded_total: number;
  semantic_match_blocked_by_compatibility_total: number;
  semantic_false_positive_review_total: number;
  semantic_candidate_to_equivalent_conversion_rate: number;
  semantic_candidate_to_distinct_rate: number;
  safeDiscoveryLift: number;
  cautionDiscoveryLift: number;
  blockedUnsafeExpansionRate: number;
  lowConfidenceSemanticRate: number;
}

const toRatio = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(6));
};

export const summarizeSemanticsRulepackMetrics = (
  samples: readonly SemanticsRulepackMetricsSample[]
): SemanticsRulepackMetricsSummary => {
  const semanticCandidateMatchesTotal = samples.length;
  const semanticRulesFiredTotal = samples.reduce(
    (sum, sample) => sum + sample.provenance.matchedRules.length,
    0
  );
  const semanticConfidenceUpliftTotal = Number(
    samples
      .reduce((sum, sample) => sum + sample.validation.semanticConfidenceContribution, 0)
      .toFixed(6)
  );
  const semanticMatchDowngradedTotal = samples.filter(
    (sample) => sample.validation.discoveryStatus === "candidate_downgraded"
  ).length;
  const semanticMatchBlockedByCompatibilityTotal = samples.filter(
    (sample) => sample.validation.safetyGateFlags.blockedByCompatibility
  ).length;
  const semanticFalsePositiveReviewTotal = samples.filter(
    (sample) => sample.validation.requiresReview
  ).length;
  const semanticCandidateToEquivalentCount = samples.filter(
    (sample) => sample.compatibilityDecisionClass === "EQUIVALENT"
  ).length;
  const semanticCandidateToDistinctCount = samples.filter((sample) =>
    sample.compatibilityDecisionClass === "DISTINCT" || sample.compatibilityDecisionClass === "DO_NOT_POOL"
  ).length;

  const safeDiscoveryLift = toRatio(
    samples.reduce((sum, sample) => sum + sample.validation.qualificationSummary.safeDiscoveryLift, 0),
    semanticCandidateMatchesTotal
  );
  const cautionDiscoveryLift = toRatio(
    samples.reduce((sum, sample) => sum + sample.validation.qualificationSummary.cautionDiscoveryLift, 0),
    semanticCandidateMatchesTotal
  );
  const blockedUnsafeExpansionRate = toRatio(
    samples.reduce((sum, sample) => sum + sample.validation.qualificationSummary.blockedUnsafeExpansionRate, 0),
    semanticCandidateMatchesTotal
  );
  const lowConfidenceSemanticRate = toRatio(
    samples.reduce((sum, sample) => sum + sample.validation.qualificationSummary.lowConfidenceSemanticRate, 0),
    semanticCandidateMatchesTotal
  );

  return {
    semantic_candidate_matches_total: semanticCandidateMatchesTotal,
    semantic_rules_fired_total: semanticRulesFiredTotal,
    semantic_confidence_uplift_total: semanticConfidenceUpliftTotal,
    semantic_match_downgraded_total: semanticMatchDowngradedTotal,
    semantic_match_blocked_by_compatibility_total: semanticMatchBlockedByCompatibilityTotal,
    semantic_false_positive_review_total: semanticFalsePositiveReviewTotal,
    semantic_candidate_to_equivalent_conversion_rate: toRatio(
      semanticCandidateToEquivalentCount,
      semanticCandidateMatchesTotal
    ),
    semantic_candidate_to_distinct_rate: toRatio(
      semanticCandidateToDistinctCount,
      semanticCandidateMatchesTotal
    ),
    safeDiscoveryLift,
    cautionDiscoveryLift,
    blockedUnsafeExpansionRate,
    lowConfidenceSemanticRate
  };
};

