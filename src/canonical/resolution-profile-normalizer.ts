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

const authorityPhraseFamilies = Object.freeze([
    {
        canonical: "official_party_sources",
        phrases: ["official democratic party sources", "official republican party sources", "official party sources"]
    },
    {
        canonical: "official_election_sources",
        phrases: ["official election sources", "official election result", "official election results"]
    },
    {
        canonical: "official_nomination_sources",
        phrases: [
            "official democratic party",
            "official republican party",
            "democratic national convention",
            "republican national convention",
            "official dnc",
            "official rnc",
            "official party nomination"
        ]
    },
    {
        canonical: "official_league_sources",
        phrases: ["official resolution source", "official premierleague com", "official nba sources", "official nfl sources", "official nhl sources"]
    },
    {
        canonical: "exchange_price_feed",
        phrases: ["pyth network", "binance", "coinbase", "price feed", "exchange as fallback"]
    }
]);

export class CanonicalResolutionProfileNormalizer {
    public normalize(input: ResolutionProfileNormalizationInput): ResolutionProfile {
        const metadataCompleteness = this.computeMetadataCompleteness(input);
        const normalizedSource = this.optionalText(input.resolutionSource);
        const normalizedTitle = this.optionalText(input.resolutionTitle);
        const normalizedAuthorityType = this.optionalText(input.resolutionAuthorityType);
        const normalizedRuleText = this.optionalRuleText(input.ruleText);
        const sourceHierarchy = input.sourceHierarchy ?? {};
        const extractedAuthorityPhrases = this.extractAuthorityPhrases(normalizedRuleText, sourceHierarchy);
        const normalizedAuthorityIdentity = this.buildAuthorityIdentity({
            normalizedAuthorityType,
            extractedAuthorityPhrases,
            sourceHierarchy
        });
        const now = new Date();

        return {
            id: buildStableTextId("crp_", input.venueMarketProfileId),
            venueMarketProfileId: input.venueMarketProfileId,
            resolutionSource: normalizedSource,
            resolutionTitle: normalizedTitle,
            normalizedResolutionAuthorityType: normalizedAuthorityType,
            ruleText: normalizedRuleText,
            sourceHierarchy,
            disputeWindowHours: this.optionalDecimalString(input.disputeWindowHours),
            ambiguityFlags: {
                ambiguousTimeBoundary: input.ambiguousTimeBoundary ?? false,
                ambiguousSourceReference: input.ambiguousSourceReference ?? false,
                ambiguousJurisdictionOrScope: input.ambiguousJurisdictionOrScope ?? false
            },
            metadataCompletenessScore: clampRatioString(metadataCompleteness),
            metadata: {
                ...(input.metadata ?? {}),
                semanticResolutionSourceClass: this.buildSemanticSourceClass(normalizedAuthorityType, extractedAuthorityPhrases),
                normalizedAuthorityIdentity,
                normalizedAuthorityPhrases: extractedAuthorityPhrases,
                resolutionSourceOverrideEligible: normalizedAuthorityIdentity !== null && extractedAuthorityPhrases.length > 0,
                resolutionSourceOverrideReason: normalizedAuthorityIdentity !== null && extractedAuthorityPhrases.length > 0
                    ? "authority_type_and_rule_phrases_aligned"
                    : "insufficient_authority_alignment"
            },
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

    private extractAuthorityPhrases(
        normalizedRuleText: string | null,
        sourceHierarchy: Record<string, unknown>
    ): readonly string[] {
        const haystack = [
            normalizedRuleText ?? "",
            normalizeFreeText(JSON.stringify(sourceHierarchy))
        ].join(" ");

        const extracted = authorityPhraseFamilies
            .filter((family) => family.phrases.some((phrase) => haystack.includes(normalizeFreeText(phrase))))
            .map((family) => family.canonical);

        return [...new Set(extracted)].sort((left, right) => left.localeCompare(right));
    }

    private buildAuthorityIdentity(input: {
        normalizedAuthorityType: string | null;
        extractedAuthorityPhrases: readonly string[];
        sourceHierarchy: Record<string, unknown>;
    }): string | null {
        const hierarchyTokens = normalizeFreeText(JSON.stringify(input.sourceHierarchy));
        const components = [
            input.normalizedAuthorityType,
            ...input.extractedAuthorityPhrases,
            hierarchyTokens.length > 0 ? hierarchyTokens : null
        ].filter((value): value is string => value !== null && value.length > 0);

        if (components.length === 0) {
            return null;
        }

        return components.join("|");
    }

    private buildSemanticSourceClass(
        normalizedAuthorityType: string | null,
        extractedAuthorityPhrases: readonly string[]
    ): string {
        if (normalizedAuthorityType === "exchange_price_feed" || extractedAuthorityPhrases.includes("exchange_price_feed")) {
            return "MARKET_DATA_AUTHORITY";
        }
        if (
            extractedAuthorityPhrases.includes("official_party_sources")
            || extractedAuthorityPhrases.includes("official_election_sources")
            || extractedAuthorityPhrases.includes("official_nomination_sources")
        ) {
            return "OFFICIAL_POLITICAL_AUTHORITY";
        }
        if (extractedAuthorityPhrases.includes("official_league_sources")) {
            return "OFFICIAL_SPORT_AUTHORITY";
        }
        return "VENUE_DECLARED_AUTHORITY";
    }
}
