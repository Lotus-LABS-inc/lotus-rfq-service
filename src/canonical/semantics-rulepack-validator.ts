import { z } from "zod";

import type { CompatibilityClass } from "./canonicalization-types.js";
import {
  propositionMatchClassificationSchema,
  propositionMatchDimensionSchema,
  type PropositionComparison,
  type StructuredProposition
} from "../simulation/proposition-matching.js";
import {
  semanticAmbiguityFlagSchema,
  semanticsRulepackProvenanceSchema,
  type SemanticAmbiguityFlag,
  type SemanticsRulepackProvenance
} from "./semantics-rulepack-versioning.js";

export const semanticDiscoveryStatusSchema = z.enum([
  "candidate_expanded",
  "candidate_downgraded",
  "candidate_blocked"
]);
export type SemanticDiscoveryStatus = z.infer<typeof semanticDiscoveryStatusSchema>;

export const semanticsRulepackConfidencePolicySchema = z.object({
  policyMaxConfidence: z.number().min(0).max(1),
  exactHistoricalQualifiedCap: z.number().min(0).max(1),
  exactLiveOnlyCap: z.number().min(0).max(1),
  cautionCap: z.number().min(0).max(1),
  blockedCap: z.number().min(0).max(1),
  lowConfidenceThreshold: z.number().min(0).max(1)
});
export type SemanticsRulepackConfidencePolicy = z.infer<typeof semanticsRulepackConfidencePolicySchema>;

export const DEFAULT_SEMANTICS_RULEPACK_CONFIDENCE_POLICY: SemanticsRulepackConfidencePolicy = {
  policyMaxConfidence: 0.92,
  exactHistoricalQualifiedCap: 0.92,
  exactLiveOnlyCap: 0.72,
  cautionCap: 0.62,
  blockedCap: 0.45,
  lowConfidenceThreshold: 0.55
};

export const semanticsRulepackSafetyGateFlagsSchema = z.object({
  semanticsCannotAssignEquivalent: z.literal(true),
  semanticsCannotBypassCompatibilityDecision: z.literal(true),
  semanticsCannotBypassSafeEquivalentGating: z.literal(true),
  semanticsCannotUnlockExecutionEligibility: z.literal(true),
  blockedByCompatibility: z.boolean(),
  compatibilityDecisionClass: z.string().nullable(),
  executionEligibilityRemainsDownstream: z.literal(true)
});
export type SemanticsRulepackSafetyGateFlags = z.infer<typeof semanticsRulepackSafetyGateFlagsSchema>;

export const semanticsRulepackQualificationSummarySchema = z.object({
  safeDiscoveryLift: z.number().min(0).max(1),
  cautionDiscoveryLift: z.number().min(0).max(1),
  blockedUnsafeExpansionRate: z.number().min(0).max(1),
  lowConfidenceSemanticRate: z.number().min(0).max(1)
});
export type SemanticsRulepackQualificationSummary = z.infer<typeof semanticsRulepackQualificationSummarySchema>;

export const semanticsRulepackValidationSchema = z.object({
  discoveryStatus: semanticDiscoveryStatusSchema,
  classification: propositionMatchClassificationSchema,
  baseConfidence: z.number().min(0).max(1),
  semanticConfidenceContribution: z.number().min(0).max(1),
  finalConfidence: z.number().min(0).max(1),
  capped: z.boolean(),
  confidenceCapReason: z.string().nullable(),
  semanticReasons: z.array(z.string()),
  failedDimensions: z.array(propositionMatchDimensionSchema),
  ambiguityFlags: z.array(semanticAmbiguityFlagSchema),
  safetyGateFlags: semanticsRulepackSafetyGateFlagsSchema,
  qualificationSummary: semanticsRulepackQualificationSummarySchema,
  requiresReview: z.boolean()
});
export type SemanticsRulepackValidation = z.infer<typeof semanticsRulepackValidationSchema>;

export interface SemanticsRulepackValidationInput {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  comparison: PropositionComparison;
  provenance: SemanticsRulepackProvenance;
  baseConfidence: number;
  exactCandidateCount?: number;
  compatibilityContext?: {
    decisionClass?: CompatibilityClass | null;
    executionEligible?: boolean;
  };
  confidencePolicy?: Partial<SemanticsRulepackConfidencePolicy>;
}

const CRITICAL_MISMATCH_DIMENSIONS = new Set([
  "timeBoundaryMatch",
  "outcomeSchemaCompatibility",
  "resolutionSourceCompatibility"
] as const);

const BENIGN_AMBIGUITY_FLAGS = new Set<SemanticAmbiguityFlag>([
  "low_confidence_field_inference"
]);

const combinePolicy = (
  policy?: Partial<SemanticsRulepackConfidencePolicy>
): SemanticsRulepackConfidencePolicy =>
  semanticsRulepackConfidencePolicySchema.parse({
    ...DEFAULT_SEMANTICS_RULEPACK_CONFIDENCE_POLICY,
    ...policy
  });

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(6));
};

const isCompatibilityBlocked = (decisionClass: CompatibilityClass | null | undefined): boolean =>
  decisionClass === "DISTINCT" || decisionClass === "DO_NOT_POOL";

const hasMaterialAmbiguity = (ambiguityFlags: readonly SemanticAmbiguityFlag[]): boolean =>
  ambiguityFlags.some((flag) => !BENIGN_AMBIGUITY_FLAGS.has(flag));

const calculateBaseContribution = (classification: z.infer<typeof propositionMatchClassificationSchema>): number => {
  switch (classification) {
    case "semantic_exact_historical_qualified":
      return 0.18;
    case "semantic_exact_live_only":
      return 0.12;
    case "semantic_near_exact":
      return 0.05;
    case "proxy_or_mismatch":
    case "unresolved_no_candidate":
    default:
      return 0;
  }
};

const resolveDiscoveryStatus = (input: {
  classification: z.infer<typeof propositionMatchClassificationSchema>;
  ambiguityFlags: readonly SemanticAmbiguityFlag[];
  criticalMismatch: boolean;
  compatibilityBlocked: boolean;
  exactCandidateCount: number;
}): SemanticDiscoveryStatus => {
  if (
    input.classification === "proxy_or_mismatch"
    || input.classification === "unresolved_no_candidate"
    || input.compatibilityBlocked
    || input.exactCandidateCount > 1
  ) {
    return "candidate_blocked";
  }
  if (input.criticalMismatch || input.classification === "semantic_near_exact" || hasMaterialAmbiguity(input.ambiguityFlags)) {
    return "candidate_downgraded";
  }
  return "candidate_expanded";
};

const resolveConfidenceCap = (input: {
  policy: SemanticsRulepackConfidencePolicy;
  classification: z.infer<typeof propositionMatchClassificationSchema>;
  criticalMismatch: boolean;
  ambiguityFlags: readonly SemanticAmbiguityFlag[];
  compatibilityBlocked: boolean;
  exactCandidateCount: number;
}): { cap: number; reason: string | null } => {
  if (input.compatibilityBlocked) {
    return { cap: input.policy.blockedCap, reason: "blocked_by_compatibility" };
  }
  if (input.exactCandidateCount > 1) {
    return { cap: input.policy.blockedCap, reason: "multiple_exact_candidates" };
  }
  if (input.classification === "proxy_or_mismatch" || input.classification === "unresolved_no_candidate") {
    return { cap: input.policy.blockedCap, reason: "semantic_mismatch" };
  }
  if (input.criticalMismatch) {
    return { cap: input.policy.cautionCap, reason: "critical_semantic_mismatch" };
  }
  if (input.classification === "semantic_near_exact" || hasMaterialAmbiguity(input.ambiguityFlags)) {
    return { cap: input.policy.cautionCap, reason: "semantic_ambiguity" };
  }
  if (input.classification === "semantic_exact_live_only") {
    return { cap: input.policy.exactLiveOnlyCap, reason: "live_only_exact_overlap" };
  }
  return { cap: input.policy.exactHistoricalQualifiedCap, reason: null };
};

export const validateSemanticsRulepackCandidate = (
  input: SemanticsRulepackValidationInput
): SemanticsRulepackValidation => {
  const policy = combinePolicy(input.confidencePolicy);
  const provenance = semanticsRulepackProvenanceSchema.parse(input.provenance);
  const exactCandidateCount = input.exactCandidateCount ?? 1;
  const baseConfidence = clampConfidence(input.baseConfidence);
  const failedDimensions = [...input.comparison.failedDimensions].sort((left, right) => left.localeCompare(right));
  const criticalMismatch = failedDimensions.some((dimension) =>
    CRITICAL_MISMATCH_DIMENSIONS.has(
      dimension as "timeBoundaryMatch" | "outcomeSchemaCompatibility" | "resolutionSourceCompatibility"
    )
  );
  const compatibilityBlocked = isCompatibilityBlocked(input.compatibilityContext?.decisionClass ?? null);
  const discoveryStatus = resolveDiscoveryStatus({
    classification: input.comparison.classification,
    ambiguityFlags: provenance.ambiguityFlags,
    criticalMismatch,
    compatibilityBlocked,
    exactCandidateCount
  });

  let semanticConfidenceContribution = calculateBaseContribution(input.comparison.classification);
  if (criticalMismatch) {
    semanticConfidenceContribution = Math.min(semanticConfidenceContribution, 0.02);
  }
  if (hasMaterialAmbiguity(provenance.ambiguityFlags)) {
    semanticConfidenceContribution = Math.min(semanticConfidenceContribution, 0.03);
  }
  if (compatibilityBlocked || exactCandidateCount > 1) {
    semanticConfidenceContribution = 0;
  }

  semanticConfidenceContribution = clampConfidence(semanticConfidenceContribution);

  const confidenceCap = resolveConfidenceCap({
    policy,
    classification: input.comparison.classification,
    criticalMismatch,
    ambiguityFlags: provenance.ambiguityFlags,
    compatibilityBlocked,
    exactCandidateCount
  });
  const uncappedConfidence = clampConfidence(baseConfidence + semanticConfidenceContribution);
  const finalConfidence = clampConfidence(
    Math.min(policy.policyMaxConfidence, confidenceCap.cap, uncappedConfidence)
  );

  const requiresReview = discoveryStatus !== "candidate_expanded"
    || hasMaterialAmbiguity(provenance.ambiguityFlags)
    || criticalMismatch;

  return semanticsRulepackValidationSchema.parse({
    discoveryStatus,
    classification: input.comparison.classification,
    baseConfidence,
    semanticConfidenceContribution,
    finalConfidence,
    capped: finalConfidence !== uncappedConfidence,
    confidenceCapReason: finalConfidence !== uncappedConfidence ? (confidenceCap.reason ?? "policy_max_confidence") : null,
    semanticReasons: [...provenance.semanticMatchReasons],
    failedDimensions,
    ambiguityFlags: [...provenance.ambiguityFlags],
    safetyGateFlags: {
      semanticsCannotAssignEquivalent: true,
      semanticsCannotBypassCompatibilityDecision: true,
      semanticsCannotBypassSafeEquivalentGating: true,
      semanticsCannotUnlockExecutionEligibility: true,
      blockedByCompatibility: compatibilityBlocked,
      compatibilityDecisionClass: input.compatibilityContext?.decisionClass ?? null,
      executionEligibilityRemainsDownstream: true
    },
    qualificationSummary: {
      safeDiscoveryLift: discoveryStatus === "candidate_expanded" && !requiresReview ? 1 : 0,
      cautionDiscoveryLift: discoveryStatus === "candidate_downgraded" || input.comparison.classification === "semantic_exact_live_only" ? 1 : 0,
      blockedUnsafeExpansionRate: discoveryStatus === "candidate_blocked" ? 1 : 0,
      lowConfidenceSemanticRate: finalConfidence < policy.lowConfidenceThreshold ? 1 : 0
    },
    requiresReview
  });
};
