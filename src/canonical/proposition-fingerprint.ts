import type {
    PropositionFingerprint,
    ResolutionProfile,
    VenueMarketProfile
} from "./canonicalization-types.js";
import {
    buildStableTextId,
    canonicalizeJsonRecord,
    clampRatioString,
    normalizeFreeText,
    normalizeWhitespace,
    serializeStableRecord
} from "./canonicalization-types.js";

export interface PropositionFingerprintBuildInput {
    market: VenueMarketProfile;
    resolutionProfile: ResolutionProfile;
    propositionHints?: {
        subject?: string | null;
        condition?: string | null;
        timeBoundary?: string | null;
        normalizedPropositionText?: string | null;
        groupingHints?: Record<string, unknown>;
    };
}

const extractBoundary = (market: VenueMarketProfile): string => {
    if (market.resolvesAt) {
        return market.resolvesAt.toISOString();
    }
    if (market.expiresAt) {
        return market.expiresAt.toISOString();
    }
    return "unknown";
};

const tokenize = (value: string): readonly string[] =>
    normalizeFreeText(value)
        .split(" ")
        .filter((token, index, values) => token.length > 1 && values.indexOf(token) === index)
        .sort((left, right) => left.localeCompare(right));

export class PropositionFingerprintBuilder {
    public build(input: PropositionFingerprintBuildInput): PropositionFingerprint {
        const normalizedPropositionText = normalizeWhitespace(
            input.propositionHints?.normalizedPropositionText
            ?? input.market.resolutionTitle
            ?? input.market.title
        );
        const subject = normalizeWhitespace(input.propositionHints?.subject ?? this.extractSubject(input.market.title));
        const condition = normalizeWhitespace(
            input.propositionHints?.condition
            ?? input.market.resolutionRulesText
            ?? input.resolutionProfile.ruleText
            ?? input.market.description
            ?? input.market.title
        );
        const timeBoundary = normalizeWhitespace(input.propositionHints?.timeBoundary ?? extractBoundary(input.market));
        const groupingHints = canonicalizeJsonRecord({
            venue: input.market.venue,
            category: input.market.category,
            topics: [...input.market.topics].sort((left, right) => left.localeCompare(right)),
            ...(input.propositionHints?.groupingHints ?? {})
        });
        const broadFingerprintKey = [
            subject || "unknown-subject",
            this.normalizeLooseCondition(condition),
            this.normalizeBoundaryBucket(timeBoundary),
            input.market.marketClass
        ].join("|");
        const strictFingerprintKey = [
            broadFingerprintKey,
            normalizeFreeText(normalizedPropositionText),
            serializeStableRecord(input.market.outcomeSchema)
        ].join("|");
        const ambiguityPenalty = [
            input.resolutionProfile.ambiguityFlags.ambiguousTimeBoundary,
            input.resolutionProfile.ambiguityFlags.ambiguousSourceReference,
            input.resolutionProfile.ambiguityFlags.ambiguousJurisdictionOrScope
        ].filter(Boolean).length;
        const confidence = Math.max(0, Number(input.market.confidenceScore) - ambiguityPenalty * 0.1);
        const now = new Date();

        return {
            id: buildStableTextId("pf_", input.market.id),
            venueMarketProfileId: input.market.id,
            subject,
            condition,
            timeBoundary,
            marketClass: input.market.marketClass,
            normalizedOutcomeSchema: input.market.outcomeSchema,
            normalizedPropositionText,
            groupingHints,
            ambiguityFlags: { ...input.resolutionProfile.ambiguityFlags },
            confidenceScore: clampRatioString(confidence),
            broadFingerprintKey,
            strictFingerprintKey,
            fingerprintHash: buildStableTextId("", strictFingerprintKey),
            createdAt: now,
            updatedAt: now
        };
    }

    private extractSubject(title: string): string {
        const tokens = tokenize(title);
        return tokens.slice(0, Math.min(tokens.length, 6)).join(" ");
    }

    private normalizeLooseCondition(value: string): string {
        return tokenize(value)
            .filter((token) => !["will", "the", "a", "an", "be"].includes(token))
            .slice(0, 12)
            .join(" ");
    }

    private normalizeBoundaryBucket(value: string): string {
        if (value === "unknown") {
            return value;
        }
        const parsed = Date.parse(value);
        if (Number.isNaN(parsed)) {
            return normalizeFreeText(value);
        }
        return new Date(parsed).toISOString().slice(0, 10);
    }
}
