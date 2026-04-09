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

const stripDisplayTimeSuffix = (value: string): string =>
    normalizeWhitespace(
        value
            .replace(/\s*\((?:[^)]*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:ET|UTC|EST|EDT|CST|CDT|PST|PDT)?[^)]*)\)\s*$/i, "")
            .replace(/\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:ET|UTC|EST|EDT|CST|CDT|PST|PDT)\s*$/i, "")
    );

export const stripDisplayTimeForBroadIdentity = (value: string): string =>
    normalizeWhitespace(
        stripDisplayTimeSuffix(
            value.replace(/\((?:[^)]*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:ET|UTC|EST|EDT|CST|CDT|PST|PDT)[^)]*)\)/gi, " ")
        )
    );

export const normalizePropositionTextForSimilarity = (value: string): string =>
    normalizeFreeText(stripDisplayTimeForBroadIdentity(value))
        .replace(
            /\b\d{1,2}\s+\d{2}(?:\s+(?:am|pm))?\s+(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi,
            " "
        )
        .replace(
            /\b\d{1,2}(?:\s+(?:am|pm))\s+(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi,
            " "
        )
        .replace(/\b(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

const parseBoundaryDate = (value: string): Date | null => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
};

const isPoliticalResultWindow = (category: string, text: string): boolean =>
    category === "POLITICS"
    && /nomination|nominee|election|primary|presidential/.test(text);

const deriveSemanticBoundary = (input: {
    rawBoundary: string;
    normalizedPropositionText: string;
    condition: string;
    category: string;
}): {
    semanticBoundaryKey: string;
    normalizationRuleFamily: string | null;
    usedFallbackRawBoundary: boolean;
} => {
    const combinedText = normalizeFreeText(`${input.normalizedPropositionText} ${input.condition}`);
    const boundaryDate = parseBoundaryDate(input.rawBoundary);

    if (
        boundaryDate
        && isPoliticalResultWindow(input.category, combinedText)
    ) {
        const shifted = new Date(boundaryDate.getTime());
        if (shifted.getUTCHours() > 0 && shifted.getUTCHours() <= 6) {
            shifted.setUTCDate(shifted.getUTCDate() - 1);
        }
        return {
            semanticBoundaryKey: `politics_result_window:${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`,
            normalizationRuleFamily: "politics_result_window_v1",
            usedFallbackRawBoundary: false
        };
    }

    if (boundaryDate) {
        return {
            semanticBoundaryKey: boundaryDate.toISOString().slice(0, 10),
            normalizationRuleFamily: null,
            usedFallbackRawBoundary: true
        };
    }

    return {
        semanticBoundaryKey: input.rawBoundary === "unknown" ? "unknown" : normalizeFreeText(input.rawBoundary),
        normalizationRuleFamily: null,
        usedFallbackRawBoundary: true
    };
};

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
        const semanticBoundary = deriveSemanticBoundary({
            rawBoundary: timeBoundary,
            normalizedPropositionText,
            condition,
            category: input.market.category
        });
        const groupingHints = canonicalizeJsonRecord({
            venue: input.market.venue,
            category: input.market.category,
            topics: [...input.market.topics].sort((left, right) => left.localeCompare(right)),
            semanticBoundaryKey: semanticBoundary.semanticBoundaryKey,
            semanticBoundaryNormalizationRule: semanticBoundary.normalizationRuleFamily,
            semanticBoundaryUsedFallback: semanticBoundary.usedFallbackRawBoundary,
            ...(input.propositionHints?.groupingHints ?? {})
        });
        const broadFingerprintKey = [
            subject || "unknown-subject",
            this.normalizeLooseCondition(condition),
            semanticBoundary.semanticBoundaryKey,
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
        const tokens = tokenize(stripDisplayTimeForBroadIdentity(title));
        return tokens.slice(0, Math.min(tokens.length, 6)).join(" ");
    }

    private normalizeLooseCondition(value: string): string {
        const normalized = normalizeFreeText(value)
            .replace(
                /\b\d{1,2}\s+\d{2}(?:\s+(?:am|pm))?\s+(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi,
                " "
            )
            .replace(
                /\b\d{1,2}(?:\s+(?:am|pm))\s+(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi,
                " "
            )
            .replace(/\b(?:et|utc|est|edt|cst|cdt|pst|pdt)\b/gi, " ");

        return normalized
            .split(" ")
            .filter((token, index, values) =>
                token.length > 1
                && values.indexOf(token) === index
                && !["will", "the", "a", "an", "be"].includes(token)
            )
            .sort((left, right) => left.localeCompare(right))
            .slice(0, 12)
            .join(" ");
    }

}
