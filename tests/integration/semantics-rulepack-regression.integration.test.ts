import { describe, expect, it } from "vitest";

import {
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionMatchCategory,
  type StructuredProposition
} from "../../src/simulation/proposition-matching.js";
import { buildSemanticsRulepackProvenance } from "../../src/canonical/semantics-rulepack-versioning.js";
import { validateSemanticsRulepackCandidate } from "../../src/canonical/semantics-rulepack-validator.js";
import { summarizeSemanticsRulepackMetrics } from "../../src/canonical/semantics-rulepack-metrics.js";

const CREATED_AT = "2026-03-28T00:00:00.000Z";

const makeProposition = (input: {
  category: PropositionMatchCategory;
  title: string;
  rules?: string | null;
  yesLabel?: string | null;
  noLabel?: string | null;
}): StructuredProposition =>
  parseStructuredProposition({
    category: input.category,
    title: input.title,
    rules: input.rules ?? null,
    yesLabel: input.yesLabel ?? "Yes",
    noLabel: input.noLabel ?? "No"
  });

const buildSample = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  historyQualified?: boolean;
  requireHistoricalQualification?: boolean;
  baseConfidence?: number;
  compatibilityDecisionClass?: "EQUIVALENT" | "COMPATIBLE_WITH_CAUTION" | "DISTINCT" | "DO_NOT_POOL" | null;
}) => {
  const comparison = compareStructuredPropositions({
    seed: input.seed,
    candidate: input.candidate,
    historyQualified: input.historyQualified ?? false,
    requireHistoricalQualification: input.requireHistoricalQualification ?? false
  });
  const provenance = buildSemanticsRulepackProvenance({
    seed: input.seed,
    candidate: input.candidate,
    comparison,
    semanticConfidenceContribution: 0,
    createdAt: CREATED_AT
  });
  const validation = validateSemanticsRulepackCandidate({
    seed: input.seed,
    candidate: input.candidate,
    comparison,
    provenance,
    baseConfidence: input.baseConfidence ?? 0.55,
    compatibilityContext: {
      decisionClass: input.compatibilityDecisionClass ?? null,
      executionEligible: false
    }
  });
  return {
    validation,
    provenance,
    compatibilityDecisionClass: input.compatibilityDecisionClass ?? null
  };
};

describe("semantics rulepack regression integration", () => {
  it("holds the known-good and known-bad regression pack at the expected safety profile", () => {
    const samples = [
      buildSample({
        seed: makeProposition({
          category: "POLITICS",
          title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
          rules: "This market resolves YES if Gavin Newsom wins the 2028 Democratic presidential nomination."
        }),
        candidate: makeProposition({
          category: "POLITICS",
          title: "Will Gavin Newsom become the 2028 Democratic nominee?",
          rules: "This market resolves YES if Gavin Newsom becomes the 2028 Democratic nominee."
        }),
        historyQualified: true,
        requireHistoricalQualification: true,
        compatibilityDecisionClass: "EQUIVALENT"
      }),
      buildSample({
        seed: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin reach all time high by March 31, 2026?",
          rules: "This market resolves YES if Bitcoin reaches all time high by March 31, 2026."
        }),
        candidate: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin close above $120,000 by March 31, 2026?",
          rules: "This market resolves YES if Bitcoin closes above $120,000 by March 31, 2026."
        }),
        compatibilityDecisionClass: "DISTINCT"
      }),
      buildSample({
        seed: makeProposition({
          category: "SPORTS",
          title: "Will the Oklahoma City Thunder win the NBA Finals in 2026?",
          rules: "This market resolves YES if the Oklahoma City Thunder win the NBA Finals in 2026."
        }),
        candidate: makeProposition({
          category: "SPORTS",
          title: "Will OKC win the NBA championship in 2026?",
          rules: "This market resolves YES if OKC win the NBA championship in 2026."
        }),
        compatibilityDecisionClass: "COMPATIBLE_WITH_CAUTION"
      }),
      buildSample({
        seed: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin close above $120,000 by June 30, 2026?",
          rules: "This market resolves YES if Bitcoin closes above $120,000 by June 30, 2026."
        }),
        candidate: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin close above $120,000 before July 2026?",
          rules: "This market resolves YES if Bitcoin closes above $120,000 before July 2026."
        }),
        compatibilityDecisionClass: "DO_NOT_POOL"
      }),
      buildSample({
        seed: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin trade above $120,000 by March 31, 2026?",
          rules: "This market resolves according to official rules if Bitcoin trades above $120,000 by March 31, 2026."
        }),
        candidate: makeProposition({
          category: "CRYPTO",
          title: "Will Bitcoin trade above $120,000 by March 31, 2026?",
          rules: "This market resolves according to Binance closing price if Bitcoin trades above $120,000 by March 31, 2026."
        }),
        compatibilityDecisionClass: "COMPATIBLE_WITH_CAUTION"
      })
    ];

    const summary = summarizeSemanticsRulepackMetrics(samples);

    expect(summary.semantic_candidate_matches_total).toBe(5);
    expect(summary.semantic_rules_fired_total).toBeGreaterThan(0);
    expect(summary.semantic_confidence_uplift_total).toBeGreaterThan(0);
    expect(summary.semantic_match_downgraded_total).toBeGreaterThanOrEqual(1);
    expect(summary.semantic_match_blocked_by_compatibility_total).toBe(2);
    expect(summary.semantic_false_positive_review_total).toBeGreaterThanOrEqual(3);
    expect(summary.semantic_candidate_to_equivalent_conversion_rate).toBe(0.2);
    expect(summary.semantic_candidate_to_distinct_rate).toBe(0.4);
    expect(summary.safeDiscoveryLift).toBeGreaterThan(0);
    expect(summary.cautionDiscoveryLift).toBeGreaterThan(0);
    expect(summary.blockedUnsafeExpansionRate).toBeGreaterThan(0);
    expect(summary.lowConfidenceSemanticRate).toBeGreaterThan(0);
  });
});

