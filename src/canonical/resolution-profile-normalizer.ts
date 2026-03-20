import Decimal from "decimal.js";

import type { ResolutionProfile } from "./canonicalization-types.js";
import { buildStableTextId, clampRatioString, normalizeFreeText, normalizeWhitespace } from "./canonicalization-types.js";

export interface ResolutionProfileNormalizationInput {
    venueMarketProfileId: string;
    resolutionSource?: string | null;
    resolutionTitle?: string | null;
    resolutionAuthorityType?: string | null;
    ruleText?: string | null;
    sourceHierarchy?: Record<string, unknown> | null;
    disputeWindowHours?: string | number | null;
    ambiguousTimeBoundary?: boolean;
    ambiguousSourceReference?: boolean;
    ambiguousJurisdictionOrScope?: boolean;
    metadata?: Record<string, unknown> | null;
}

export class CanonicalResolutionProfileNormalizer {
    public normalize(input: ResolutionProfileNormalizationInput): ResolutionProfile {
        const metadataCompleteness = this.computeMetadataCompleteness(input);
        const now = new Date();

        return {
            id: buildStableTextId("crp_", input.venueMarketProfileId),
            venueMarketProfileId: input.venueMarketProfileId,
            resolutionSource: this.optionalText(input.resolutionSource),
            resolutionTitle: this.optionalText(input.resolutionTitle),
            normalizedResolutionAuthorityType: this.optionalText(input.resolutionAuthorityType),
            ruleText: this.optionalRuleText(input.ruleText),
            sourceHierarchy: input.sourceHierarchy ?? {},
            disputeWindowHours: this.optionalDecimalString(input.disputeWindowHours),
            ambiguityFlags: {
                ambiguousTimeBoundary: input.ambiguousTimeBoundary ?? false,
                ambiguousSourceReference: input.ambiguousSourceReference ?? false,
                ambiguousJurisdictionOrScope: input.ambiguousJurisdictionOrScope ?? false
            },
            metadataCompletenessScore: clampRatioString(metadataCompleteness),
            metadata: input.metadata ?? {},
            createdAt: now,
            updatedAt: now
        };
    }

    private optionalText(value: string | null | undefined): string | null {
        if (typeof value !== "string") {
            return null;
        }
        const normalized = normalizeWhitespace(value);
        return normalized.length === 0 ? null : normalized;
    }

    private optionalRuleText(value: string | null | undefined): string | null {
        if (typeof value !== "string") {
            return null;
        }
        const normalized = normalizeFreeText(value);
        return normalized.length === 0 ? null : normalized;
    }

    private optionalDecimalString(value: string | number | null | undefined): string | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const decimal = new Decimal(value);
        if (!decimal.isFinite() || decimal.isNegative()) {
            return null;
        }
        return decimal.toString();
    }

    private computeMetadataCompleteness(input: ResolutionProfileNormalizationInput): number {
        const flags = [
            typeof input.resolutionSource === "string" && normalizeWhitespace(input.resolutionSource).length > 0,
            typeof input.resolutionTitle === "string" && normalizeWhitespace(input.resolutionTitle).length > 0,
            typeof input.resolutionAuthorityType === "string" && normalizeWhitespace(input.resolutionAuthorityType).length > 0,
            typeof input.ruleText === "string" && normalizeWhitespace(input.ruleText).length > 0,
            input.sourceHierarchy !== null && input.sourceHierarchy !== undefined,
            input.disputeWindowHours !== null && input.disputeWindowHours !== undefined
        ];

        return flags.filter(Boolean).length / flags.length;
    }
}
