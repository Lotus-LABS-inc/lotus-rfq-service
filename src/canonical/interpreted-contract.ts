import { buildStableTextId, canonicalizeJsonRecord, clampRatioString } from "./canonicalization-types.js";
import type {
    InterpretedContract,
    InterpretedContractAmbiguityFlags,
    InterpretedContractBuildInput
} from "./interpreted-contract-types.js";

export const deriveInterpretedContractId = (
    canonicalEventId: string,
    venueMarketProfileId: string,
    sourceMetadataVersion: string
): string =>
    buildStableTextId("contract_", `${canonicalEventId}|${venueMarketProfileId}|${sourceMetadataVersion}`);

export const determineInterpretedContractAmbiguity = (
    input: InterpretedContractBuildInput
): InterpretedContractAmbiguityFlags => ({
    ambiguousTimeBoundary:
        input.fingerprint.ambiguityFlags.ambiguousTimeBoundary ||
        input.resolutionProfile.ambiguityFlags.ambiguousTimeBoundary ||
        (!input.market.expiresAt && !input.market.resolvesAt),
    ambiguousSourceReference:
        input.fingerprint.ambiguityFlags.ambiguousSourceReference ||
        input.resolutionProfile.ambiguityFlags.ambiguousSourceReference,
    ambiguousJurisdictionOrScope:
        input.fingerprint.ambiguityFlags.ambiguousJurisdictionOrScope ||
        input.resolutionProfile.ambiguityFlags.ambiguousJurisdictionOrScope,
    missingCriticalOutcomeSemantics:
        input.market.outcomes.length === 0 || Object.keys(input.market.outcomeSchema).length === 0,
    missingCriticalTimingSemantics:
        !input.market.expiresAt && !input.market.resolvesAt,
    missingCriticalResolutionSemantics:
        !input.resolutionProfile.normalizedResolutionAuthorityType ||
        !input.resolutionProfile.ruleText
});

export const deriveInterpretedContractConfidence = (
    input: InterpretedContractBuildInput,
    ambiguity: InterpretedContractAmbiguityFlags
): string => {
    const values = [
        Number(input.market.confidenceScore),
        Number(input.fingerprint.confidenceScore),
        Number(input.resolutionProfile.metadataCompletenessScore),
        Number(input.settlementProfile.metadataCompletenessScore)
    ].filter((value) => Number.isFinite(value));

    const baseScore = values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const ambiguityPenalty =
        Number(ambiguity.ambiguousTimeBoundary) * 0.12 +
        Number(ambiguity.ambiguousSourceReference) * 0.08 +
        Number(ambiguity.ambiguousJurisdictionOrScope) * 0.08 +
        Number(ambiguity.missingCriticalOutcomeSemantics) * 0.25 +
        Number(ambiguity.missingCriticalTimingSemantics) * 0.25 +
        Number(ambiguity.missingCriticalResolutionSemantics) * 0.25;
    return clampRatioString(baseScore - ambiguityPenalty);
};

export const isInterpretedContractPoolable = (
    ambiguity: InterpretedContractAmbiguityFlags,
    interpretationConfidence: string
): boolean =>
    !ambiguity.missingCriticalOutcomeSemantics &&
    !ambiguity.missingCriticalTimingSemantics &&
    !ambiguity.missingCriticalResolutionSemantics &&
    Number(interpretationConfidence) >= 0.55;

export const buildInterpretedContractRecord = (input: InterpretedContractBuildInput): InterpretedContract => {
    const ambiguityFlags = determineInterpretedContractAmbiguity(input);
    const interpretationConfidence = deriveInterpretedContractConfidence(input, ambiguityFlags);
    const now = new Date();

    return {
        id: deriveInterpretedContractId(input.market.canonicalEventId, input.market.id, input.market.sourceMetadataVersion),
        venue: input.market.venue,
        venueMarketId: input.market.venueMarketId,
        canonicalEventId: input.market.canonicalEventId,
        venueMarketProfileId: input.market.id,
        propositionFingerprintId: input.fingerprint.id,
        resolutionProfileId: input.resolutionProfile.id,
        settlementProfileId: input.settlementProfile.id,
        normalizedPropositionSemantics: canonicalizeJsonRecord({
            subject: input.fingerprint.subject,
            condition: input.fingerprint.condition,
            normalizedPropositionText: input.fingerprint.normalizedPropositionText,
            groupingHints: input.fingerprint.groupingHints
        }),
        normalizedOutcomeSemantics: canonicalizeJsonRecord({
            marketClass: input.market.marketClass,
            outcomeSchema: input.market.outcomeSchema,
            outcomes: input.market.outcomes
        }),
        normalizedTimingSemantics: canonicalizeJsonRecord({
            publishedAt: input.market.publishedAt?.toISOString() ?? null,
            expiresAt: input.market.expiresAt?.toISOString() ?? null,
            resolvesAt: input.market.resolvesAt?.toISOString() ?? null,
            timeBoundary: input.fingerprint.timeBoundary
        }),
        normalizedResolutionSemantics: canonicalizeJsonRecord({
            resolutionSource: input.resolutionProfile.resolutionSource,
            resolutionTitle: input.resolutionProfile.resolutionTitle,
            normalizedResolutionAuthorityType: input.resolutionProfile.normalizedResolutionAuthorityType,
            ruleText: input.resolutionProfile.ruleText,
            sourceHierarchy: input.resolutionProfile.sourceHierarchy
        }),
        normalizedSettlementSemantics: canonicalizeJsonRecord({
            settlementType: input.settlementProfile.settlementType,
            settlementLagHours: input.settlementProfile.settlementLagHours,
            disputeWindowHours: input.settlementProfile.disputeWindowHours,
            finalityLagHours: input.settlementProfile.finalityLagHours,
            payoutTimingHours: input.settlementProfile.payoutTimingHours,
            feeOnEntry: input.settlementProfile.feeOnEntry,
            feeOnExit: input.settlementProfile.feeOnExit,
            requiresConservativeAnchor: input.settlementProfile.requiresConservativeAnchor
        }),
        ambiguityFlags,
        interpretationConfidence,
        sourceMetadataVersion: input.market.sourceMetadataVersion,
        rawLineageReferences: canonicalizeJsonRecord({
            venueMarketProfileId: input.market.id,
            propositionFingerprintId: input.fingerprint.id,
            resolutionProfileId: input.resolutionProfile.id,
            settlementProfileId: input.settlementProfile.id,
            mappingLineage: input.market.mappingLineage
        }),
        isPoolable: isInterpretedContractPoolable(ambiguityFlags, interpretationConfidence),
        createdAt: now,
        updatedAt: now
    };
};
