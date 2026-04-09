import { describe, expect, it } from "vitest";

import {
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionMatchCategory,
  type StructuredProposition
} from "../../src/simulation/proposition-matching.js";
import { buildSemanticsRulepackProvenance } from "../../src/canonical/semantics-rulepack-versioning.js";
import { validateSemanticsRulepackCandidate } from "../../src/canonical/semantics-rulepack-validator.js";

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

const validatePair = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  historyQualified?: boolean;
  requireHistoricalQualification?: boolean;
  baseConfidence?: number;
  exactCandidateCount?: number;
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
    createdAt: CREATED_AT,
    ...(input.exactCandidateCount === undefined ? {} : { exactCandidateCount: input.exactCandidateCount })
  });
  const validation = validateSemanticsRulepackCandidate({
    seed: input.seed,
    candidate: input.candidate,
    comparison,
    provenance,
    baseConfidence: input.baseConfidence ?? 0.54,
    ...(input.exactCandidateCount === undefined ? {} : { exactCandidateCount: input.exactCandidateCount }),
    compatibilityContext: {
      decisionClass: input.compatibilityDecisionClass ?? null,
      executionEligible: false
    }
  });
  return { comparison, provenance, validation };
};

describe("semantics rulepack validation integration", () => {
  it("widens true-positive discovery while keeping execution downstream", () => {
    const seed = makeProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
      rules: "This market resolves YES if Gavin Newsom wins the 2028 Democratic presidential nomination."
    });
    const candidate = makeProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom become the 2028 Democratic nominee?",
      rules: "This market resolves YES if Gavin Newsom becomes the 2028 Democratic nominee."
    });

    const result = validatePair({
      seed,
      candidate,
      historyQualified: true,
      requireHistoricalQualification: true,
      compatibilityDecisionClass: "COMPATIBLE_WITH_CAUTION"
    });

    expect(result.comparison.classification).toBe("semantic_exact_historical_qualified");
    expect(result.validation.discoveryStatus).toBe("candidate_expanded");
    expect(result.validation.semanticConfidenceContribution).toBeGreaterThan(0);
    expect(result.validation.finalConfidence).toBeGreaterThan(result.validation.baseConfidence);
    expect(result.provenance.matchedRules.length).toBeGreaterThan(0);
    expect(result.validation.safetyGateFlags.semanticsCannotBypassCompatibilityDecision).toBe(true);
  });

  it("blocks false-positive promotion for similar wording with different underlying trigger", () => {
    const seed = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin reach all time high by March 31, 2026?",
      rules: "This market resolves YES if Bitcoin reaches a new all time high by March 31, 2026."
    });
    const candidate = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin close above $120,000 by March 31, 2026?",
      rules: "This market resolves YES if Bitcoin closes above $120,000 on March 31, 2026."
    });

    const result = validatePair({
      seed,
      candidate,
      historyQualified: false,
      requireHistoricalQualification: true,
      compatibilityDecisionClass: "DISTINCT"
    });

    expect(result.validation.discoveryStatus).toBe("candidate_blocked");
    expect(result.validation.safetyGateFlags.blockedByCompatibility).toBe(true);
    expect(result.validation.safetyGateFlags.compatibilityDecisionClass).toBe("DISTINCT");
    expect(result.validation.finalConfidence).toBeLessThanOrEqual(0.45);
  });

  it("keeps timing mismatches visible and downgraded", () => {
    const seed = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin close above $120,000 by June 30, 2026?",
      rules: "This market resolves YES if Bitcoin closes above $120,000 by June 30, 2026."
    });
    const candidate = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin close above $120,000 before July 2026?",
      rules: "This market resolves YES if Bitcoin closes above $120,000 before July 2026."
    });

    const result = validatePair({
      seed,
      candidate,
      baseConfidence: 0.58
    });

    expect(result.comparison.failedDimensions).toContain("timeBoundaryMatch");
    expect(result.validation.discoveryStatus).toBe("candidate_downgraded");
    expect(result.validation.ambiguityFlags).toContain("timing_semantics_ambiguous");
    expect(result.validation.finalConfidence).toBeLessThanOrEqual(0.62);
  });

  it("prevents outcome-schema flattening", () => {
    const seed = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin finish above $120,000 on March 31, 2026?",
      rules: "This market resolves YES if Bitcoin finishes above $120,000 on March 31, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const candidate = makeProposition({
      category: "CRYPTO",
      title: "Bitcoin up or down on March 31, 2026?",
      rules: "This market resolves UP if Bitcoin is up on March 31, 2026 and DOWN otherwise.",
      yesLabel: "Up",
      noLabel: "Down"
    });

    const result = validatePair({
      seed,
      candidate,
      compatibilityDecisionClass: "DO_NOT_POOL"
    });

    expect(result.comparison.failedDimensions).toContain("outcomeSchemaCompatibility");
    expect(result.validation.discoveryStatus).toBe("candidate_blocked");
    expect(result.validation.safetyGateFlags.blockedByCompatibility).toBe(true);
  });

  it("keeps resolution mismatches out of executable equivalence", () => {
    const seed = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin trade above $120,000 by March 31, 2026?",
      rules: "This market resolves according to official rules if Bitcoin trades above $120,000 by March 31, 2026."
    });
    const candidate = makeProposition({
      category: "CRYPTO",
      title: "Will Bitcoin trade above $120,000 by March 31, 2026?",
      rules: "This market resolves according to Binance closing price if Bitcoin trades above $120,000 by March 31, 2026."
    });

    const result = validatePair({
      seed,
      candidate,
      compatibilityDecisionClass: "COMPATIBLE_WITH_CAUTION"
    });

    expect(result.comparison.failedDimensions).toContain("resolutionSourceCompatibility");
    expect(result.validation.discoveryStatus).toBe("candidate_downgraded");
    expect(result.validation.ambiguityFlags).toContain("resolution_semantics_ambiguous");
  });

  it("fails closed when semantics are ambiguous across multiple exact candidates", () => {
    const seed = makeProposition({
      category: "SPORTS",
      title: "Will the Oklahoma City Thunder win the NBA Finals in 2026?",
      rules: "This market resolves YES if the Oklahoma City Thunder win the NBA Finals in 2026."
    });
    const candidate = makeProposition({
      category: "SPORTS",
      title: "Will OKC win the NBA championship in 2026?",
      rules: "This market resolves YES if OKC win the NBA championship in 2026."
    });

    const result = validatePair({
      seed,
      candidate,
      exactCandidateCount: 2,
      compatibilityDecisionClass: "COMPATIBLE_WITH_CAUTION"
    });

    expect(result.validation.discoveryStatus).toBe("candidate_blocked");
    expect(result.validation.ambiguityFlags).toContain("multiple_exact_candidates");
    expect(result.validation.qualificationSummary.blockedUnsafeExpansionRate).toBe(1);
  });
});
