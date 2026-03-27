import { buildStableTextId, canonicalizeJsonRecord } from "./canonicalization-types.js";
import type { CompatibilityClass } from "./canonicalization-types.js";
import type { CompatibilityReasonCode } from "./compatibility-reason-codes.js";

export interface CompatibilityDecision {
    id: string;
    canonicalEventId: string;
    interpretedContractAId: string;
    interpretedContractBId: string;
    compatibilityVersionId: string;
    replayReference: string | null;
    compatibilityClass: CompatibilityClass;
    reasonCodes: readonly CompatibilityReasonCode[];
    hardBlocks: readonly string[];
    cautionConditions: readonly string[];
    softPenalties: readonly Readonly<Record<string, unknown>>[];
    confidenceScore: string;
    factorBreakdown: Readonly<Record<string, unknown>>;
    supportingReasons: readonly string[];
    reviewerOverrideMetadata: Readonly<Record<string, unknown>>;
    computedAt: Date;
}

export interface CompatibilityDecisionBuildInput {
    canonicalEventId: string;
    interpretedContractAId: string;
    interpretedContractBId: string;
    compatibilityVersionId: string;
    compatibilityClass: CompatibilityClass;
    reasonCodes: readonly CompatibilityReasonCode[];
    hardBlocks: readonly string[];
    cautionConditions: readonly string[];
    softPenalties: readonly Readonly<Record<string, unknown>>[];
    confidenceScore: string;
    factorBreakdown: Readonly<Record<string, unknown>>;
    supportingReasons: readonly string[];
    replayReference?: string | null;
    reviewerOverrideMetadata?: Readonly<Record<string, unknown>>;
    computedAt?: Date;
}

export const buildCompatibilityDecisionId = (
    canonicalEventId: string,
    interpretedContractAId: string,
    interpretedContractBId: string,
    compatibilityVersionId: string
): string => {
    const [left, right] =
        interpretedContractAId.localeCompare(interpretedContractBId) <= 0
            ? [interpretedContractAId, interpretedContractBId]
            : [interpretedContractBId, interpretedContractAId];
    return buildStableTextId("decision_", `${canonicalEventId}|${left}|${right}|${compatibilityVersionId}`);
};

export const buildCompatibilityDecisionRecord = (
    input: CompatibilityDecisionBuildInput
): CompatibilityDecision => ({
    id: buildCompatibilityDecisionId(
        input.canonicalEventId,
        input.interpretedContractAId,
        input.interpretedContractBId,
        input.compatibilityVersionId
    ),
    canonicalEventId: input.canonicalEventId,
    interpretedContractAId: input.interpretedContractAId,
    interpretedContractBId: input.interpretedContractBId,
    compatibilityVersionId: input.compatibilityVersionId,
    replayReference: input.replayReference ?? null,
    compatibilityClass: input.compatibilityClass,
    reasonCodes: [...input.reasonCodes],
    hardBlocks: [...input.hardBlocks],
    cautionConditions: [...input.cautionConditions],
    softPenalties: input.softPenalties.map((entry) => canonicalizeJsonRecord({ ...entry })),
    confidenceScore: input.confidenceScore,
    factorBreakdown: canonicalizeJsonRecord({ ...input.factorBreakdown }),
    supportingReasons: [...input.supportingReasons],
    reviewerOverrideMetadata: canonicalizeJsonRecord({ ...(input.reviewerOverrideMetadata ?? {}) }),
    computedAt: input.computedAt ?? new Date()
});
