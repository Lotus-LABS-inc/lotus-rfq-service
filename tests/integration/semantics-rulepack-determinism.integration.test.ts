import { describe, expect, it } from "vitest";

import {
  compareStructuredPropositions,
  parseStructuredProposition
} from "../../src/simulation/proposition-matching.js";
import {
  DEFAULT_SEMANTICS_RULEPACK_VERSION,
  buildSemanticsRulepackProvenance
} from "../../src/canonical/semantics-rulepack-versioning.js";
import { validateSemanticsRulepackCandidate } from "../../src/canonical/semantics-rulepack-validator.js";

const CREATED_AT = "2026-03-28T00:00:00.000Z";

const seed = parseStructuredProposition({
  category: "POLITICS",
  title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
  rules: "This market resolves YES if Gavin Newsom wins the 2028 Democratic presidential nomination.",
  yesLabel: "Yes",
  noLabel: "No"
});

const candidate = parseStructuredProposition({
  category: "POLITICS",
  title: "Will Gavin Newsom become the 2028 Democratic nominee?",
  rules: "This market resolves YES if Gavin Newsom becomes the 2028 Democratic nominee.",
  yesLabel: "Yes",
  noLabel: "No"
});

const comparison = compareStructuredPropositions({
  seed,
  candidate,
  historyQualified: true,
  requireHistoricalQualification: true
});

describe("semantics rulepack determinism integration", () => {
  it("produces identical provenance and validation for identical inputs and version", () => {
    const firstProvenance = buildSemanticsRulepackProvenance({
      seed,
      candidate,
      comparison,
      semanticConfidenceContribution: 0,
      createdAt: CREATED_AT,
      semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION
    });
    const secondProvenance = buildSemanticsRulepackProvenance({
      seed,
      candidate,
      comparison,
      semanticConfidenceContribution: 0,
      createdAt: CREATED_AT,
      semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION
    });

    const firstValidation = validateSemanticsRulepackCandidate({
      seed,
      candidate,
      comparison,
      provenance: firstProvenance,
      baseConfidence: 0.56
    });
    const secondValidation = validateSemanticsRulepackCandidate({
      seed,
      candidate,
      comparison,
      provenance: secondProvenance,
      baseConfidence: 0.56
    });

    expect(secondProvenance).toEqual(firstProvenance);
    expect(secondValidation).toEqual(firstValidation);
  });

  it("changes provenance identity when the rulepack version changes", () => {
    const firstProvenance = buildSemanticsRulepackProvenance({
      seed,
      candidate,
      comparison,
      semanticConfidenceContribution: 0,
      createdAt: CREATED_AT,
      semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION
    });
    const secondProvenance = buildSemanticsRulepackProvenance({
      seed,
      candidate,
      comparison,
      semanticConfidenceContribution: 0,
      createdAt: CREATED_AT,
      semanticsRulepackVersion: "semantic-rulepack-v2"
    });

    expect(secondProvenance.evaluationId).not.toBe(firstProvenance.evaluationId);
    expect(secondProvenance.matchedRules.map((rule) => rule.ruleId)).not.toEqual(
      firstProvenance.matchedRules.map((rule) => rule.ruleId)
    );
  });
});

