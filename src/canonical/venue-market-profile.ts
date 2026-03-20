import type {
    CanonicalCategory,
    CanonicalFeeProfile,
    CanonicalMarketClass,
    CanonicalOutcomeDefinition,
    CanonicalVenue,
    VenueMarketProfile
} from "./canonicalization-types.js";
import {
    buildStableTextId,
    clampRatioString,
    normalizeCategory,
    normalizeMarketClass,
    normalizeWhitespace
} from "./canonicalization-types.js";

export interface VenueMarketProfileInput {
    canonicalEventId: string;
    venue: CanonicalVenue;
    venueMarketId: string;
    title: string;
    description?: string | null;
    marketType?: string | null;
    marketClass?: CanonicalMarketClass | string | null;
    outcomes?: readonly CanonicalOutcomeDefinition[];
    outcomeSchema?: Record<string, unknown>;
    topics?: readonly string[];
    category?: CanonicalCategory | string | null;
    publishedAt?: Date | null;
    expiresAt?: Date | null;
    resolvesAt?: Date | null;
    fees?: CanonicalFeeProfile;
    feeModel?: string | null;
    resolutionSource?: string | null;
    resolutionTitle?: string | null;
    resolutionRulesText?: string | null;
    network?: string | null;
    chain?: string | null;
    rawSourcePayload?: Record<string, unknown>;
    normalizedPayload?: Record<string, unknown>;
    mappingLineage?: readonly string[];
    confidenceScore?: string;
    sourceMetadataVersion: string;
}

export class VenueMarketProfileFactory {
    public create(input: VenueMarketProfileInput): VenueMarketProfile {
        const now = new Date();
        const title = normalizeWhitespace(input.title);
        if (title.length === 0) {
            throw new Error("venue_market_profile_title_required");
        }
        if (input.venueMarketId.trim().length === 0) {
            throw new Error("venue_market_id_required");
        }

        return {
            id: buildStableTextId("vmp_", `${input.venue}:${input.venueMarketId}`),
            venue: input.venue,
            venueMarketId: input.venueMarketId,
            canonicalEventId: input.canonicalEventId,
            title,
            description: this.optionalText(input.description),
            marketType: this.optionalText(input.marketType),
            marketClass: normalizeMarketClass(input.marketClass ?? null),
            outcomes: Object.freeze([...(input.outcomes ?? [])]),
            outcomeSchema: input.outcomeSchema ?? {},
            topics: Object.freeze([...(input.topics ?? [])]),
            category: normalizeCategory(input.category ?? null),
            publishedAt: input.publishedAt ?? null,
            expiresAt: input.expiresAt ?? null,
            resolvesAt: input.resolvesAt ?? null,
            fees: input.fees ?? {},
            feeModel: this.optionalText(input.feeModel),
            resolutionSource: this.optionalText(input.resolutionSource),
            resolutionTitle: this.optionalText(input.resolutionTitle),
            resolutionRulesText: this.optionalText(input.resolutionRulesText),
            network: this.optionalText(input.network),
            chain: this.optionalText(input.chain),
            rawSourcePayload: input.rawSourcePayload ?? {},
            normalizedPayload: input.normalizedPayload ?? {},
            mappingLineage: Object.freeze([...(input.mappingLineage ?? [])]),
            confidenceScore: input.confidenceScore ?? clampRatioString(this.computeConfidence(input)),
            sourceMetadataVersion: input.sourceMetadataVersion,
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

    private computeConfidence(input: VenueMarketProfileInput): number {
        const fields = [
            normalizeWhitespace(input.title).length > 0,
            input.outcomes !== undefined && input.outcomes.length > 0,
            input.outcomeSchema !== undefined,
            input.expiresAt !== undefined,
            input.resolvesAt !== undefined,
            input.resolutionSource !== undefined,
            input.sourceMetadataVersion.trim().length > 0
        ];

        return fields.filter(Boolean).length / fields.length;
    }
}
