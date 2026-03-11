import Decimal from "decimal.js";
import type {
    CreateNormalizedResolutionProfileInput,
    FlatResolutionVenueMetadata,
    NestedRulesResolutionVenueMetadata,
    OracleDocumentResolutionVenueMetadata,
    ResolutionProfileNormalizerInput
} from "./resolution-risk.types.js";

type AmbiguityFlags = {
    hasAmbiguousTimeBoundary: boolean;
    hasAmbiguousJurisdictionBoundary: boolean;
    hasAmbiguousSourceReference: boolean;
};

type ExtractedResolutionFields = {
    oracleType: string;
    oracleName: string | null;
    resolutionAuthorityType: string;
    primaryResolutionText: string;
    supplementalRulesText: string | null;
    disputeWindowHours: string | null;
    settlementLagHours: string | null;
    marketType: string;
    outcomeSchema: Record<string, unknown>;
    ambiguityFlags: AmbiguityFlags;
    historicalDivergenceRate: string | null;
    metadata: Record<string, unknown>;
};

export class ResolutionProfileNormalizationError extends Error {
    public readonly code:
        | "missing_required_resolution_metadata"
        | "invalid_resolution_metadata_shape"
        | "invalid_numeric_resolution_metadata"
        | "invalid_outcome_schema"
        | "invalid_ambiguity_flag";

    public constructor(
        code:
            | "missing_required_resolution_metadata"
            | "invalid_resolution_metadata_shape"
            | "invalid_numeric_resolution_metadata"
            | "invalid_outcome_schema"
            | "invalid_ambiguity_flag"
    ) {
        super(code);
        this.name = "ResolutionProfileNormalizationError";
        this.code = code;
    }
}

export interface IResolutionProfileNormalizer {
    normalize(input: ResolutionProfileNormalizerInput): CreateNormalizedResolutionProfileInput;
}

export class ResolutionProfileNormalizer implements IResolutionProfileNormalizer {
    public normalize(input: ResolutionProfileNormalizerInput): CreateNormalizedResolutionProfileInput {
        const extracted = this.extractByShape(input.venueMetadata);

        return {
            venue: input.market.venue,
            venueMarketId: input.market.venueMarketId,
            canonicalEventId: input.market.canonicalEventId,
            oracleType: extracted.oracleType,
            oracleName: extracted.oracleName,
            resolutionAuthorityType: extracted.resolutionAuthorityType,
            primaryResolutionText: extracted.primaryResolutionText,
            supplementalRulesText: extracted.supplementalRulesText,
            disputeWindowHours: extracted.disputeWindowHours,
            settlementLagHours: extracted.settlementLagHours,
            marketType: extracted.marketType,
            outcomeSchema: extracted.outcomeSchema,
            hasAmbiguousTimeBoundary: extracted.ambiguityFlags.hasAmbiguousTimeBoundary,
            hasAmbiguousJurisdictionBoundary: extracted.ambiguityFlags.hasAmbiguousJurisdictionBoundary,
            hasAmbiguousSourceReference: extracted.ambiguityFlags.hasAmbiguousSourceReference,
            historicalDivergenceRate: extracted.historicalDivergenceRate,
            metadata: extracted.metadata
        };
    }

    private extractByShape(
        metadata: ResolutionProfileNormalizerInput["venueMetadata"]
    ): ExtractedResolutionFields {
        switch (metadata.shape) {
            case "flat":
                return this.extractFromFlat(metadata);
            case "nested_rules":
                return this.extractFromNested(metadata);
            case "oracle_document":
                return this.extractFromOracleDocument(metadata);
            default:
                throw new ResolutionProfileNormalizationError("invalid_resolution_metadata_shape");
        }
    }

    private extractFromFlat(metadata: FlatResolutionVenueMetadata): ExtractedResolutionFields {
        return {
            oracleType: this.requireNonEmptyString(metadata.oracleType),
            oracleName: this.optionalNonEmptyString(metadata.oracleName),
            resolutionAuthorityType: this.requireNonEmptyString(metadata.resolutionAuthorityType),
            primaryResolutionText: this.requireNonEmptyString(metadata.primaryResolutionText),
            supplementalRulesText: this.optionalNonEmptyString(metadata.supplementalRulesText),
            disputeWindowHours: this.normalizeNumeric(metadata.disputeWindowHours),
            settlementLagHours: this.normalizeNumeric(metadata.settlementLagHours),
            marketType: this.requireNonEmptyString(metadata.marketType),
            outcomeSchema: this.requireObject(metadata.outcomeSchema),
            ambiguityFlags: this.normalizeAmbiguityFlags({
                timeBoundary: metadata.hasAmbiguousTimeBoundary,
                jurisdictionBoundary: metadata.hasAmbiguousJurisdictionBoundary,
                sourceReference: metadata.hasAmbiguousSourceReference
            }),
            historicalDivergenceRate: this.normalizeNumeric(metadata.historicalDivergenceRate),
            metadata: this.normalizeMetadata(metadata.metadata)
        };
    }

    private extractFromNested(metadata: NestedRulesResolutionVenueMetadata): ExtractedResolutionFields {
        return {
            oracleType: this.requireNonEmptyString(metadata.oracle?.type),
            oracleName: this.optionalNonEmptyString(metadata.oracle?.name),
            resolutionAuthorityType: this.requireNonEmptyString(metadata.rules?.authorityType),
            primaryResolutionText: this.requireNonEmptyString(metadata.rules?.primaryText),
            supplementalRulesText: this.optionalNonEmptyString(metadata.rules?.supplementalText),
            disputeWindowHours: this.normalizeNumeric(metadata.timing?.disputeWindowHours),
            settlementLagHours: this.normalizeNumeric(metadata.timing?.settlementLagHours),
            marketType: this.requireNonEmptyString(metadata.market?.type),
            outcomeSchema: this.requireObject(metadata.market?.outcomeSchema),
            ambiguityFlags: this.normalizeAmbiguityFlags({
                timeBoundary: metadata.ambiguity?.timeBoundary,
                jurisdictionBoundary: metadata.ambiguity?.jurisdictionBoundary,
                sourceReference: metadata.ambiguity?.sourceReference
            }),
            historicalDivergenceRate: this.normalizeNumeric(metadata.history?.divergenceRate),
            metadata: this.normalizeMetadata(metadata.metadata)
        };
    }

    private extractFromOracleDocument(metadata: OracleDocumentResolutionVenueMetadata): ExtractedResolutionFields {
        return {
            oracleType: this.requireNonEmptyString(metadata.resolution?.oracle?.type),
            oracleName: this.optionalNonEmptyString(metadata.resolution?.oracle?.name),
            resolutionAuthorityType: this.requireNonEmptyString(metadata.resolution?.authority?.type),
            primaryResolutionText: this.requireNonEmptyString(metadata.resolution?.primaryText),
            supplementalRulesText: this.optionalNonEmptyString(metadata.documents?.supplementalRulesText),
            disputeWindowHours: this.normalizeNumeric(metadata.windows?.disputeHours),
            settlementLagHours: this.normalizeNumeric(metadata.windows?.settlementLagHours),
            marketType: this.requireNonEmptyString(metadata.resolution?.marketType),
            outcomeSchema: this.requireObject(metadata.resolution?.outcomeSchema),
            ambiguityFlags: this.normalizeAmbiguityFlags({
                timeBoundary: metadata.flags?.ambiguousTimeBoundary,
                jurisdictionBoundary: metadata.flags?.ambiguousJurisdictionBoundary,
                sourceReference: metadata.flags?.ambiguousSourceReference
            }),
            historicalDivergenceRate: this.normalizeNumeric(metadata.stats?.historicalDivergenceRate),
            metadata: this.normalizeMetadata(metadata.metadata)
        };
    }

    private requireNonEmptyString(value: unknown): string {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new ResolutionProfileNormalizationError("missing_required_resolution_metadata");
        }

        return value.trim();
    }

    private optionalNonEmptyString(value: unknown): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value !== "string" || value.trim().length === 0) {
            throw new ResolutionProfileNormalizationError("invalid_resolution_metadata_shape");
        }

        return value.trim();
    }

    private requireObject(value: unknown): Record<string, unknown> {
        if (
            value === null ||
            value === undefined ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            throw new ResolutionProfileNormalizationError("invalid_outcome_schema");
        }

        return { ...(value as Record<string, unknown>) };
    }

    private normalizeMetadata(value: unknown): Record<string, unknown> {
        if (value === undefined || value === null) {
            return {};
        }

        if (typeof value !== "object" || Array.isArray(value)) {
            throw new ResolutionProfileNormalizationError("invalid_resolution_metadata_shape");
        }

        return { ...(value as Record<string, unknown>) };
    }

    private normalizeNumeric(value: unknown): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        try {
            const decimal = new Decimal(value as string | number);
            if (!decimal.isFinite() || decimal.isNegative()) {
                throw new ResolutionProfileNormalizationError("invalid_numeric_resolution_metadata");
            }
            return decimal.toString();
        } catch (error) {
            if (error instanceof ResolutionProfileNormalizationError) {
                throw error;
            }
            throw new ResolutionProfileNormalizationError("invalid_numeric_resolution_metadata");
        }
    }

    private normalizeAmbiguityFlags(flags: {
        timeBoundary: unknown;
        jurisdictionBoundary: unknown;
        sourceReference: unknown;
    }): AmbiguityFlags {
        return {
            hasAmbiguousTimeBoundary: this.normalizeBooleanFlag(flags.timeBoundary),
            hasAmbiguousJurisdictionBoundary: this.normalizeBooleanFlag(flags.jurisdictionBoundary),
            hasAmbiguousSourceReference: this.normalizeBooleanFlag(flags.sourceReference)
        };
    }

    private normalizeBooleanFlag(value: unknown): boolean {
        if (value === undefined) {
            return false;
        }

        if (typeof value !== "boolean") {
            throw new ResolutionProfileNormalizationError("invalid_ambiguity_flag");
        }

        return value;
    }
}
