import { z } from "zod";

import {
  buildStableTextId,
  serializeStableRecord
} from "./canonicalization-types.js";
import {
  propositionMatchDimensionSchema,
  propositionMatchClassificationSchema,
  propositionFieldConfidenceSchema,
  propositionFieldSchema,
  resolutionSourceTypeSchema,
  structuredOutcomeSchemaTypeSchema,
  type PropositionComparison,
  type StructuredProposition
} from "../simulation/proposition-matching.js";

export const DEFAULT_SEMANTICS_RULEPACK_VERSION = "semantic-rulepack-v1";

export const semanticAmbiguityFlagSchema = z.enum([
  "multiple_exact_candidates",
  "timing_semantics_ambiguous",
  "outcome_semantics_ambiguous",
  "resolution_semantics_ambiguous",
  "low_confidence_field_inference",
  "semantic_near_exact"
]);
export type SemanticAmbiguityFlag = z.infer<typeof semanticAmbiguityFlagSchema>;

export const semanticRulepackReplayLinkageSchema = z.object({
  replayEnvelopeId: z.string().nullable(),
  parentDecisionType: z.string().nullable(),
  parentDecisionId: z.string().nullable()
});
export type SemanticsRulepackReplayLinkage = z.infer<typeof semanticRulepackReplayLinkageSchema>;

export const semanticMatchedRuleSchema = z.object({
  ruleId: z.string().min(1),
  ruleKey: z.string().min(1),
  ruleFamily: z.string().min(1)
});
export type SemanticMatchedRule = z.infer<typeof semanticMatchedRuleSchema>;

const semanticFieldInferenceSchema = z.object({
  raw: z.string().nullable(),
  normalized: z.string().nullable(),
  confidence: propositionFieldConfidenceSchema,
  aliasesApplied: z.array(z.string()).default([]),
  ruleEvidence: z.array(z.string()).default([])
});
export type SemanticFieldInference = z.infer<typeof semanticFieldInferenceSchema>;

export const semanticNormalizedPropositionElementsSchema = z.object({
  subject: z.object({
    seed: propositionFieldSchema,
    candidate: propositionFieldSchema
  }),
  actionOrCondition: z.object({
    seed: propositionFieldSchema,
    candidate: propositionFieldSchema
  }),
  threshold: z.object({
    seed: propositionFieldSchema,
    candidate: propositionFieldSchema
  }),
  deadlineOrSeason: z.object({
    seed: propositionFieldSchema,
    candidate: propositionFieldSchema
  }),
  competitionOrContext: z.object({
    seed: propositionFieldSchema,
    candidate: propositionFieldSchema
  })
});
export type SemanticNormalizedPropositionElements = z.infer<typeof semanticNormalizedPropositionElementsSchema>;

export const semanticTimingInferenceSchema = z.object({
  seed: semanticFieldInferenceSchema,
  candidate: semanticFieldInferenceSchema,
  matched: z.boolean(),
  ambiguity: z.boolean()
});
export type SemanticTimingInference = z.infer<typeof semanticTimingInferenceSchema>;

export const semanticOutcomeInferenceSchema = z.object({
  seedOutcomeSchema: z.object({
    raw: z.string().nullable(),
    normalized: structuredOutcomeSchemaTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  candidateOutcomeSchema: z.object({
    raw: z.string().nullable(),
    normalized: structuredOutcomeSchemaTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  seedResolutionSourceType: z.object({
    raw: z.string().nullable(),
    normalized: resolutionSourceTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  candidateResolutionSourceType: z.object({
    raw: z.string().nullable(),
    normalized: resolutionSourceTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  outcomeMatched: z.boolean(),
  resolutionMatched: z.boolean(),
  ambiguity: z.boolean()
});
export type SemanticOutcomeInference = z.infer<typeof semanticOutcomeInferenceSchema>;

export const semanticsRulepackProvenanceSchema = z.object({
  evaluationId: z.string().min(1),
  semanticsRulepackVersion: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  matchedRules: z.array(semanticMatchedRuleSchema),
  matchedRuleFamilies: z.array(z.string()),
  matchedSemanticDimensions: z.array(propositionMatchDimensionSchema),
  semanticMatchReasons: z.array(z.string()),
  normalizedPropositionElements: semanticNormalizedPropositionElementsSchema,
  timingSemantics: semanticTimingInferenceSchema,
  outcomeSemantics: semanticOutcomeInferenceSchema,
  ambiguityFlags: z.array(semanticAmbiguityFlagSchema),
  semanticConfidenceContribution: z.number().min(0).max(1),
  semanticClassification: propositionMatchClassificationSchema,
  replayLinkage: semanticRulepackReplayLinkageSchema
});
export type SemanticsRulepackProvenance = z.infer<typeof semanticsRulepackProvenanceSchema>;

const extractRuleEvidence = (proposition: StructuredProposition): readonly string[] => {
  const allRuleEvidence = [
    ...proposition.subject.ruleEvidence,
    ...proposition.actionOrCondition.ruleEvidence,
    ...proposition.threshold.ruleEvidence,
    ...proposition.deadlineOrSeason.ruleEvidence,
    ...proposition.competitionOrContext.ruleEvidence,
    ...proposition.outcomeSchema.ruleEvidence,
    ...proposition.resolutionSourceType.ruleEvidence
  ];

  return [...new Set(allRuleEvidence)].sort((left, right) => left.localeCompare(right));
};

const deriveRuleFamily = (ruleKey: string): string => {
  const [family] = ruleKey.split(":");
  return family ?? "semantic";
};

const buildMatchedRules = (
  semanticsRulepackVersion: string,
  seed: StructuredProposition,
  candidate: StructuredProposition
): readonly SemanticMatchedRule[] => {
  const ruleKeys = [...new Set([...extractRuleEvidence(seed), ...extractRuleEvidence(candidate)])]
    .sort((left, right) => left.localeCompare(right));

  return ruleKeys.map((ruleKey) => ({
    ruleId: buildStableTextId("semrule_", `${semanticsRulepackVersion}:${ruleKey}`),
    ruleKey,
    ruleFamily: deriveRuleFamily(ruleKey)
  }));
};

const buildAmbiguityFlags = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  comparison: PropositionComparison;
  exactCandidateCount: number;
}): SemanticAmbiguityFlag[] => {
  const flags = new Set<SemanticAmbiguityFlag>();

  if (input.exactCandidateCount > 1) {
    flags.add("multiple_exact_candidates");
  }
  if (input.comparison.classification === "semantic_near_exact") {
    flags.add("semantic_near_exact");
  }
  if (
    input.comparison.failedDimensions.includes("timeBoundaryMatch")
    || (input.seed.deadlineOrSeason.normalized === null) !== (input.candidate.deadlineOrSeason.normalized === null)
  ) {
    flags.add("timing_semantics_ambiguous");
  }
  if (
    input.comparison.failedDimensions.includes("outcomeSchemaCompatibility")
    || input.seed.outcomeSchema.normalized === "UNKNOWN"
    || input.candidate.outcomeSchema.normalized === "UNKNOWN"
  ) {
    flags.add("outcome_semantics_ambiguous");
  }
  if (
    input.comparison.failedDimensions.includes("resolutionSourceCompatibility")
    || input.seed.resolutionSourceType.normalized === "UNKNOWN"
    || input.candidate.resolutionSourceType.normalized === "UNKNOWN"
  ) {
    flags.add("resolution_semantics_ambiguous");
  }

  const hasLowConfidenceField = [
    input.seed.subject.confidence,
    input.seed.actionOrCondition.confidence,
    input.seed.threshold.confidence,
    input.seed.deadlineOrSeason.confidence,
    input.seed.competitionOrContext.confidence,
    input.candidate.subject.confidence,
    input.candidate.actionOrCondition.confidence,
    input.candidate.threshold.confidence,
    input.candidate.deadlineOrSeason.confidence,
    input.candidate.competitionOrContext.confidence
  ].some((confidence) => confidence === "LOW" || confidence === "NONE");

  if (hasLowConfidenceField) {
    flags.add("low_confidence_field_inference");
  }

  return [...flags].sort((left, right) => left.localeCompare(right));
};

const buildSemanticMatchReasons = (input: {
  comparison: PropositionComparison;
  matchedRules: readonly SemanticMatchedRule[];
  ambiguityFlags: readonly SemanticAmbiguityFlag[];
}): string[] => {
  const reasons = new Set<string>();

  reasons.add(`classification:${input.comparison.classification}`);
  for (const rule of input.matchedRules) {
    reasons.add(`rule:${rule.ruleKey}`);
  }
  for (const dimension of input.comparison.dimensionResults) {
    reasons.add(
      `${dimension.matched ? "matched" : "failed"}:${dimension.dimension}:${dimension.reasonCode}`
    );
  }
  for (const flag of input.ambiguityFlags) {
    reasons.add(`ambiguity:${flag}`);
  }

  return [...reasons].sort((left, right) => left.localeCompare(right));
};

export const buildSemanticsRulepackProvenance = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  comparison: PropositionComparison;
  semanticConfidenceContribution: number;
  semanticsRulepackVersion?: string;
  createdAt: string;
  replayLinkage?: Partial<SemanticsRulepackReplayLinkage>;
  exactCandidateCount?: number;
}): SemanticsRulepackProvenance => {
  const semanticsRulepackVersion = input.semanticsRulepackVersion ?? DEFAULT_SEMANTICS_RULEPACK_VERSION;
  const exactCandidateCount = input.exactCandidateCount ?? 1;
  const matchedRules = buildMatchedRules(semanticsRulepackVersion, input.seed, input.candidate);
  const matchedSemanticDimensions = input.comparison.dimensionResults
    .filter((dimension) => dimension.matched)
    .map((dimension) => dimension.dimension)
    .sort((left, right) => left.localeCompare(right));
  const ambiguityFlags = buildAmbiguityFlags({
    seed: input.seed,
    candidate: input.candidate,
    comparison: input.comparison,
    exactCandidateCount
  });
  const semanticMatchReasons = buildSemanticMatchReasons({
    comparison: input.comparison,
    matchedRules,
    ambiguityFlags
  });

  const evaluationId = buildStableTextId(
    "semprov_",
    serializeStableRecord({
      semanticsRulepackVersion,
      exactCandidateCount,
      classification: input.comparison.classification,
      seed: {
        category: input.seed.category,
        sourceText: input.seed.sourceText,
        parserVersion: input.seed.parserVersion,
        subject: input.seed.subject.normalized,
        actionOrCondition: input.seed.actionOrCondition.normalized,
        threshold: input.seed.threshold.normalized,
        deadlineOrSeason: input.seed.deadlineOrSeason.normalized,
        competitionOrContext: input.seed.competitionOrContext.normalized,
        outcomeSchema: input.seed.outcomeSchema.normalized,
        resolutionSourceType: input.seed.resolutionSourceType.normalized
      },
      candidate: {
        category: input.candidate.category,
        sourceText: input.candidate.sourceText,
        parserVersion: input.candidate.parserVersion,
        subject: input.candidate.subject.normalized,
        actionOrCondition: input.candidate.actionOrCondition.normalized,
        threshold: input.candidate.threshold.normalized,
        deadlineOrSeason: input.candidate.deadlineOrSeason.normalized,
        competitionOrContext: input.candidate.competitionOrContext.normalized,
        outcomeSchema: input.candidate.outcomeSchema.normalized,
        resolutionSourceType: input.candidate.resolutionSourceType.normalized
      },
      matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
      matchedSemanticDimensions,
      ambiguityFlags,
      semanticConfidenceContribution: Number(input.semanticConfidenceContribution.toFixed(6))
    })
  );

  return semanticsRulepackProvenanceSchema.parse({
    evaluationId,
    semanticsRulepackVersion,
    createdAt: input.createdAt,
    matchedRules,
    matchedRuleFamilies: [...new Set(matchedRules.map((rule) => rule.ruleFamily))].sort((left, right) => left.localeCompare(right)),
    matchedSemanticDimensions,
    semanticMatchReasons,
    normalizedPropositionElements: {
      subject: {
        seed: input.seed.subject,
        candidate: input.candidate.subject
      },
      actionOrCondition: {
        seed: input.seed.actionOrCondition,
        candidate: input.candidate.actionOrCondition
      },
      threshold: {
        seed: input.seed.threshold,
        candidate: input.candidate.threshold
      },
      deadlineOrSeason: {
        seed: input.seed.deadlineOrSeason,
        candidate: input.candidate.deadlineOrSeason
      },
      competitionOrContext: {
        seed: input.seed.competitionOrContext,
        candidate: input.candidate.competitionOrContext
      }
    },
    timingSemantics: {
      seed: input.seed.deadlineOrSeason,
      candidate: input.candidate.deadlineOrSeason,
      matched: !input.comparison.failedDimensions.includes("timeBoundaryMatch"),
      ambiguity: ambiguityFlags.includes("timing_semantics_ambiguous")
    },
    outcomeSemantics: {
      seedOutcomeSchema: input.seed.outcomeSchema,
      candidateOutcomeSchema: input.candidate.outcomeSchema,
      seedResolutionSourceType: input.seed.resolutionSourceType,
      candidateResolutionSourceType: input.candidate.resolutionSourceType,
      outcomeMatched: !input.comparison.failedDimensions.includes("outcomeSchemaCompatibility"),
      resolutionMatched: !input.comparison.failedDimensions.includes("resolutionSourceCompatibility"),
      ambiguity: ambiguityFlags.includes("outcome_semantics_ambiguous")
        || ambiguityFlags.includes("resolution_semantics_ambiguous")
    },
    ambiguityFlags,
    semanticConfidenceContribution: Number(input.semanticConfidenceContribution.toFixed(6)),
    semanticClassification: input.comparison.classification,
    replayLinkage: {
      replayEnvelopeId: input.replayLinkage?.replayEnvelopeId ?? null,
      parentDecisionType: input.replayLinkage?.parentDecisionType ?? null,
      parentDecisionId: input.replayLinkage?.parentDecisionId ?? null
    }
  });
};
