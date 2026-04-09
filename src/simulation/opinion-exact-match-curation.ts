import { z } from "zod";

import {
  propositionComparisonSchema,
  propositionMatchClassificationSchema,
  propositionMatchCategorySchema,
  propositionFieldConfidenceSchema,
  structuredPropositionSchema,
  parseStructuredProposition,
  compareStructuredPropositions,
  canLooseMatchCategoryText,
  type PropositionComparison,
  type PropositionMatchCategory,
  type StructuredProposition
} from "./proposition-matching.js";
import {
  historicalCatalogCategorySchema,
  historicalCatalogVenueSchema,
  type HistoricalCatalogManifestEntry,
  type HistoricalRouteCuration
} from "./historical-route-catalog-manifest.js";
import {
  semanticsRulepackProvenanceSchema,
  DEFAULT_SEMANTICS_RULEPACK_VERSION,
  buildSemanticsRulepackProvenance
} from "../canonical/semantics-rulepack-versioning.js";
import {
  semanticsRulepackValidationSchema,
  validateSemanticsRulepackCandidate
} from "../canonical/semantics-rulepack-validator.js";

export const hybridOpinionSeedBasisSchema = z.enum(["historical", "live"]);
export type HybridOpinionSeedBasis = z.infer<typeof hybridOpinionSeedBasisSchema>;

export const opinionExactMatchDecisionStatusSchema = z.enum([
  "semantic_exact_historical_qualified",
  "semantic_exact_live_only",
  "semantic_near_exact",
  "proxy_or_mismatch",
  "unresolved_no_candidate",
  "rejected_ambiguous"
]);
export type OpinionExactMatchDecisionStatus = z.infer<typeof opinionExactMatchDecisionStatusSchema>;

export const opinionExactMatchSourceSchema = z.object({
  type: z.enum([
    "seed_selection",
    "public_site",
    "search_query",
    "opinion_openapi_market_list",
    "predexon_validation",
    "db_inventory"
  ]),
  reference: z.string(),
  observation: z.string()
});

export const opinionExactMatchVenueMeaningSchema = z.object({
  venue: historicalCatalogVenueSchema,
  venueMarketId: z.string(),
  title: z.string()
});

export const opinionExactMatchCandidateSnapshotSchema = z.object({
  marketId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().nullable(),
  status: z.string().nullable(),
  labels: z.array(z.string()),
  rules: z.string().nullable(),
  yesLabel: z.string().nullable(),
  noLabel: z.string().nullable(),
  quoteToken: z.string().nullable(),
  chainId: z.string().nullable(),
  questionId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }).nullable(),
  cutoffAt: z.string().datetime({ offset: true }).nullable(),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  category: propositionMatchCategorySchema,
  metadataVersion: z.string()
});

export const opinionExactMatchRejectedCandidateSchema = z.object({
  marketId: z.string(),
  title: z.string(),
  classification: propositionMatchClassificationSchema,
  primaryFailureReason: z.string().nullable(),
  failedDimensions: z.array(z.string()),
  reasonCode: z.string(),
  reason: z.string()
});

export const opinionExactMatchProjectionImpactSchema = z.object({
  liveExactOverlap: z.boolean(),
  historicalPairEligible: z.boolean(),
  triRoutePotential: z.boolean()
});

export const opinionExactMatchHistoricalQualificationSchema = z.object({
  required: z.boolean(),
  passed: z.boolean(),
  reference: z.string().nullable(),
  observation: z.string()
});

export const opinionExactMatchCandidateEvaluationSchema = z.object({
  candidateSnapshot: opinionExactMatchCandidateSnapshotSchema,
  structuredProposition: structuredPropositionSchema,
  comparison: propositionComparisonSchema,
  semanticProvenance: semanticsRulepackProvenanceSchema,
  semanticValidation: semanticsRulepackValidationSchema,
  historicalQualification: opinionExactMatchHistoricalQualificationSchema,
  rankingScore: z.number().int().nonnegative(),
  isNearMiss: z.boolean()
});

export const opinionExactMatchAcceptedCandidateSchema = z.object({
  marketId: z.string(),
  title: z.string(),
  classification: z.enum(["semantic_exact_historical_qualified", "semantic_exact_live_only"]),
  evidenceReference: z.string(),
  candidateSnapshot: opinionExactMatchCandidateSnapshotSchema,
  structuredProposition: structuredPropositionSchema,
  comparison: propositionComparisonSchema,
  semanticProvenance: semanticsRulepackProvenanceSchema,
  semanticValidation: semanticsRulepackValidationSchema,
  historicalQualification: opinionExactMatchHistoricalQualificationSchema,
  impact: opinionExactMatchProjectionImpactSchema
});

export const opinionExactMatchSeedSchema = z.object({
  category: propositionMatchCategorySchema,
  basis: hybridOpinionSeedBasisSchema,
  canonicalEventId: z.string(),
  canonicalMarketId: z.string(),
  title: z.string(),
  currentVenueMeanings: z.array(opinionExactMatchVenueMeaningSchema).min(1),
  historyWindow: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true })
  }).nullable(),
  publicReference: z.string(),
  searchQueries: z.array(z.string()),
  seedReference: z.string(),
  structuredProposition: structuredPropositionSchema
});

export const opinionExactMatchCurationEntrySchema = z.object({
  category: propositionMatchCategorySchema,
  selectedSeed: opinionExactMatchSeedSchema,
  decision: z.object({
    status: opinionExactMatchDecisionStatusSchema,
    reasonCode: z.string(),
    reason: z.string()
  }),
  searchedSources: z.array(opinionExactMatchSourceSchema),
  candidateEvaluations: z.array(opinionExactMatchCandidateEvaluationSchema),
  nearMissCandidates: z.array(opinionExactMatchCandidateEvaluationSchema),
  rejectedCandidates: z.array(opinionExactMatchRejectedCandidateSchema),
  acceptedCandidate: opinionExactMatchAcceptedCandidateSchema.optional()
});

export const opinionExactMatchCurationSchema = z.object({
  version: z.number().int().positive(),
  observedAt: z.string(),
  policy: z.object({
    matchRule: z.string(),
    autoAcceptRule: z.string(),
    historicalValidationRule: z.string(),
    mutationRule: z.string(),
    semanticsRulepackVersion: z.string()
  }),
  entries: z.array(opinionExactMatchCurationEntrySchema)
});

export type OpinionExactMatchCuration = z.infer<typeof opinionExactMatchCurationSchema>;
export type OpinionExactMatchCurationEntry = z.infer<typeof opinionExactMatchCurationEntrySchema>;
export type OpinionExactMatchCandidateSnapshot = z.infer<typeof opinionExactMatchCandidateSnapshotSchema>;
export type OpinionExactMatchCandidateEvaluation = z.infer<typeof opinionExactMatchCandidateEvaluationSchema>;
export type HybridOpinionSeed = z.infer<typeof opinionExactMatchSeedSchema>;

export interface OpinionLiveFallbackSeed {
  category: PropositionMatchCategory;
  canonicalEventId: string;
  canonicalMarketId: string;
  title: string;
  venueMarketId: string;
}

const CATEGORIES: readonly PropositionMatchCategory[] = ["POLITICS", "CRYPTO", "SPORTS", "ESPORTS"];

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const confidenceScoreByField: Record<z.infer<typeof propositionFieldConfidenceSchema>, number> = {
  NONE: 0,
  LOW: 0.35,
  MEDIUM: 0.65,
  HIGH: 0.9
};

const chooseHistoricalSeedForCategory = (
  curation: HistoricalRouteCuration,
  category: PropositionMatchCategory
): HistoricalCatalogManifestEntry | null =>
  curation.routes.find((route) =>
    route.decision.status === "accepted"
    && route.canonicalCategory === category
    && route.venueProfiles.some((profile) => profile.venue === "POLYMARKET")
    && route.venueProfiles.some((profile) => profile.venue === "LIMITLESS")
  ) ?? null;

const computeHistoryWindowIntersection = (
  entry: HistoricalCatalogManifestEntry
): { start: string; end: string } | null => {
  const starts = entry.venueProfiles.map((profile) => new Date(profile.historyWindow.start).getTime());
  const ends = entry.venueProfiles.map((profile) => new Date(profile.historyWindow.end).getTime());
  if (starts.length === 0 || ends.length === 0) {
    return null;
  }
  const start = Math.max(...starts);
  const end = Math.min(...ends);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString()
  };
};

const buildSeedStructuredProposition = (
  category: PropositionMatchCategory,
  title: string,
  venueMeanings: readonly { title: string }[]
): StructuredProposition =>
  parseStructuredProposition({
    category,
    title: unique([title, ...venueMeanings.map((meaning) => meaning.title)]).join(" | "),
    rules: null,
    yesLabel: "Yes",
    noLabel: "No"
  });

export const selectHybridFourSeeds = (input: {
  curation: HistoricalRouteCuration;
  liveOpinionSeeds: readonly OpinionLiveFallbackSeed[];
}): readonly HybridOpinionSeed[] =>
  CATEGORIES.map((category) => {
    const historical = chooseHistoricalSeedForCategory(input.curation, category);
    if (historical) {
      const currentVenueMeanings = historical.venueProfiles.map((profile) => ({
        venue: profile.venue,
        venueMarketId: profile.venueMarketId,
        title: profile.title
      }));
      return opinionExactMatchSeedSchema.parse({
        category,
        basis: "historical",
        canonicalEventId: historical.historicalCanonicalEventId,
        canonicalMarketId: historical.historicalCanonicalMarketId,
        title: historical.title,
        currentVenueMeanings,
        historyWindow: computeHistoryWindowIntersection(historical),
        publicReference:
          historical.discoveredFrom.find((source) => source.type === "public_site")?.reference
          ?? "https://docs.opinion.trade/developer-guide/opinion-open-api/overview",
        searchQueries: unique(
          historical.discoveredFrom
            .filter((source) => source.type === "search_query")
            .map((source) => source.reference)
        ),
        seedReference: historical.historicalCanonicalMarketId,
        structuredProposition: buildSeedStructuredProposition(category, historical.title, currentVenueMeanings)
      });
    }

    const live = input.liveOpinionSeeds.find((seed) => seed.category === category);
    if (!live) {
      throw new Error(`No historical or live Opinion hybrid seed found for category ${category}.`);
    }

    const currentVenueMeanings = [
      {
        venue: "OPINION" as const,
        venueMarketId: live.venueMarketId,
        title: live.title
      }
    ];

    return opinionExactMatchSeedSchema.parse({
      category,
      basis: "live",
      canonicalEventId: live.canonicalEventId,
      canonicalMarketId: live.canonicalMarketId,
      title: live.title,
      currentVenueMeanings,
      historyWindow: null,
      publicReference: "https://docs.opinion.trade/developer-guide/opinion-open-api/overview",
      searchQueries: [`site:opinion.trade "${live.title}"`],
      seedReference: live.venueMarketId,
      structuredProposition: buildSeedStructuredProposition(category, live.title, currentVenueMeanings)
    });
  });

export const toOpinionCandidateSnapshot = (input: {
  marketId: string;
  title: string;
  slug: string | null;
  status: string | null;
  labels: readonly string[];
  rules: string | null;
  yesLabel: string | null;
  noLabel: string | null;
  quoteToken: string | null;
  chainId: string | null;
  questionId: string | null;
  createdAt: Date | null;
  cutoffAt: Date | null;
  resolvedAt: Date | null;
  category: PropositionMatchCategory;
  metadataVersion: string;
}): OpinionExactMatchCandidateSnapshot =>
  opinionExactMatchCandidateSnapshotSchema.parse({
    marketId: input.marketId,
    title: input.title,
    slug: input.slug,
    status: input.status,
    labels: [...input.labels],
    rules: input.rules,
    yesLabel: input.yesLabel,
    noLabel: input.noLabel,
    quoteToken: input.quoteToken,
    chainId: input.chainId,
    questionId: input.questionId,
    createdAt: input.createdAt?.toISOString() ?? null,
    cutoffAt: input.cutoffAt?.toISOString() ?? null,
    resolvedAt: input.resolvedAt?.toISOString() ?? null,
    category: input.category,
    metadataVersion: input.metadataVersion
  });

const classificationToReason = (comparison: PropositionComparison, historyRequired: boolean, historyPassed: boolean): { reasonCode: string; reason: string } => {
  switch (comparison.classification) {
    case "semantic_exact_historical_qualified":
      return {
        reasonCode: "semantic_exact_historical_qualified",
        reason: "Candidate satisfies every required structured dimension and has documented historical evidence."
      };
    case "semantic_exact_live_only":
      return {
        reasonCode: historyRequired && !historyPassed ? "semantic_exact_missing_history" : "semantic_exact_live_only",
        reason: historyRequired && !historyPassed
          ? "Candidate satisfies every required structured dimension but lacks historical evidence, so it is live-only exact overlap."
          : "Candidate satisfies every required structured dimension and is accepted as live-only exact overlap."
      };
    case "semantic_near_exact":
      return {
        reasonCode: comparison.primaryFailureReason ?? "semantic_near_exact",
        reason: "Candidate is close but fails one or more required structured dimensions."
      };
    case "proxy_or_mismatch":
      return {
        reasonCode: comparison.primaryFailureReason ?? "proxy_or_mismatch",
        reason: "Candidate is related inventory but not the same executable proposition."
      };
    case "unresolved_no_candidate":
    default:
      return {
        reasonCode: "no_candidate_in_opinion_inventory",
        reason: "No Opinion market in the scanned inventory produced a viable candidate."
      };
  }
};

export const evaluateOpinionCandidate = (input: {
  seed: HybridOpinionSeed;
  candidate: OpinionExactMatchCandidateSnapshot;
  historyPassed: boolean;
}): OpinionExactMatchCandidateEvaluation => {
  const structuredProposition = parseStructuredProposition({
    category: input.seed.category,
    title: input.candidate.title,
    rules: input.candidate.rules,
    yesLabel: input.candidate.yesLabel,
    noLabel: input.candidate.noLabel
  });
  const comparison = compareStructuredPropositions({
    seed: input.seed.structuredProposition,
    candidate: structuredProposition,
    historyQualified: input.historyPassed,
    requireHistoricalQualification: input.seed.basis === "historical"
  });
  const semanticProvenance = buildSemanticsRulepackProvenance({
    seed: input.seed.structuredProposition,
    candidate: structuredProposition,
    comparison,
    semanticConfidenceContribution: 0,
    semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION,
    createdAt:
      input.candidate.createdAt
      ?? input.seed.historyWindow?.start
      ?? "1970-01-01T00:00:00.000Z"
  });
  const semanticValidation = validateSemanticsRulepackCandidate({
    seed: input.seed.structuredProposition,
    candidate: structuredProposition,
    comparison,
    provenance: semanticProvenance,
    baseConfidence: deriveSemanticBaseConfidence(input.seed.structuredProposition, structuredProposition)
  });
  const finalizedSemanticProvenance = buildSemanticsRulepackProvenance({
    seed: input.seed.structuredProposition,
    candidate: structuredProposition,
    comparison,
    semanticConfidenceContribution: semanticValidation.semanticConfidenceContribution,
    semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION,
    createdAt:
      input.candidate.createdAt
      ?? input.seed.historyWindow?.start
      ?? "1970-01-01T00:00:00.000Z"
  });
  const finalizedSemanticValidation = validateSemanticsRulepackCandidate({
    seed: input.seed.structuredProposition,
    candidate: structuredProposition,
    comparison,
    provenance: finalizedSemanticProvenance,
    baseConfidence: deriveSemanticBaseConfidence(input.seed.structuredProposition, structuredProposition)
  });

  return opinionExactMatchCandidateEvaluationSchema.parse({
    candidateSnapshot: input.candidate,
    structuredProposition,
    comparison,
    semanticProvenance: finalizedSemanticProvenance,
    semanticValidation: finalizedSemanticValidation,
    historicalQualification: {
      required: input.seed.basis === "historical",
      passed: input.historyPassed,
      reference: null,
      observation: input.seed.basis === "historical"
        ? input.historyPassed
          ? "Documented historical validation passed."
          : "Documented historical validation did not return evidence."
        : "Historical validation was not required because the selected hybrid seed is live."
    },
    rankingScore: comparison.matchScore,
    isNearMiss: comparison.classification === "semantic_near_exact"
  });
};

function deriveSemanticBaseConfidence(
  seed: StructuredProposition,
  candidate: StructuredProposition
): number {
  const confidenceValues = [
    seed.subject.confidence,
    seed.actionOrCondition.confidence,
    seed.threshold.confidence,
    seed.deadlineOrSeason.confidence,
    seed.competitionOrContext.confidence,
    seed.outcomeSchema.confidence,
    seed.resolutionSourceType.confidence,
    candidate.subject.confidence,
    candidate.actionOrCondition.confidence,
    candidate.threshold.confidence,
    candidate.deadlineOrSeason.confidence,
    candidate.competitionOrContext.confidence,
    candidate.outcomeSchema.confidence,
    candidate.resolutionSourceType.confidence
  ];

  const total = confidenceValues.reduce((sum, confidence) => sum + confidenceScoreByField[confidence], 0);
  return Number((total / confidenceValues.length).toFixed(6));
}

export const shouldConsiderLooseCandidate = (seed: HybridOpinionSeed, candidate: OpinionExactMatchCandidateSnapshot): boolean =>
  candidate.category === seed.category
  && (
    canLooseMatchCategoryText(seed.category, `${candidate.title} ${candidate.rules ?? ""}`)
    || canLooseMatchCategoryText(seed.category, `${seed.title} ${seed.currentVenueMeanings.map((meaning) => meaning.title).join(" ")}`)
  );

export const buildAcceptedImpact = (input: {
  seed: HybridOpinionSeed;
  classification: "semantic_exact_historical_qualified" | "semantic_exact_live_only";
}) => ({
  liveExactOverlap: true,
  historicalPairEligible: input.classification === "semantic_exact_historical_qualified",
  triRoutePotential:
    input.seed.currentVenueMeanings.some((meaning) => meaning.venue === "POLYMARKET")
    && input.seed.currentVenueMeanings.some((meaning) => meaning.venue === "LIMITLESS")
});

export const buildRejectedCandidate = (evaluation: OpinionExactMatchCandidateEvaluation) => {
  const reason = classificationToReason(
    evaluation.comparison,
    evaluation.historicalQualification.required,
    evaluation.historicalQualification.passed
  );
  return opinionExactMatchRejectedCandidateSchema.parse({
    marketId: evaluation.candidateSnapshot.marketId,
    title: evaluation.candidateSnapshot.title,
    classification: evaluation.comparison.classification,
    primaryFailureReason: evaluation.comparison.primaryFailureReason,
    failedDimensions: evaluation.comparison.failedDimensions,
    reasonCode: reason.reasonCode,
    reason: reason.reason
  });
};
