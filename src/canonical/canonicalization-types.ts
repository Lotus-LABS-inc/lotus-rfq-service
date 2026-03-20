import { createHash } from "node:crypto";

export const canonicalVenueValues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD"] as const;
export type CanonicalVenue = typeof canonicalVenueValues[number];

export const canonicalCategoryValues = [
    "SPORTS",
    "CRYPTO",
    "POLITICS",
    "ESPORTS",
    "POP_CULTURE",
    "ECONOMICS",
    "OTHER"
] as const;
export type CanonicalCategory = typeof canonicalCategoryValues[number];

export const canonicalMarketClassValues = [
    "BINARY",
    "CATEGORICAL",
    "SCALAR",
    "MULTI_OUTCOME",
    "UNKNOWN"
] as const;
export type CanonicalMarketClass = typeof canonicalMarketClassValues[number];

export const compatibilityClassValues = [
    "EQUIVALENT",
    "COMPATIBLE_WITH_CAUTION",
    "DISTINCT",
    "DO_NOT_POOL"
] as const;
export type CompatibilityClass = typeof compatibilityClassValues[number];

export const settlementTypeValues = ["onchain", "offchain", "hybrid", "unknown"] as const;
export type SettlementType = typeof settlementTypeValues[number];

export interface CanonicalOutcomeDefinition {
    id: string;
    label: string;
    tokenId?: string | null;
    outcomeType?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
}

export interface CanonicalFeeProfile {
    makerFeeBps?: string | null;
    takerFeeBps?: string | null;
    settlementFeeBps?: string | null;
    flatFee?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
}

export interface ResolutionProfile {
    id: string;
    venueMarketProfileId: string;
    resolutionSource: string | null;
    resolutionTitle: string | null;
    normalizedResolutionAuthorityType: string | null;
    ruleText: string | null;
    sourceHierarchy: Readonly<Record<string, unknown>>;
    disputeWindowHours: string | null;
    ambiguityFlags: {
        ambiguousTimeBoundary: boolean;
        ambiguousSourceReference: boolean;
        ambiguousJurisdictionOrScope: boolean;
    };
    metadataCompletenessScore: string;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

export interface SettlementProfile {
    id: string;
    venueMarketProfileId: string;
    settlementType: SettlementType;
    settlementLagHours: string | null;
    disputeWindowHours: string | null;
    finalityLagHours: string | null;
    payoutTimingHours: string | null;
    feeOnEntry: boolean;
    feeOnExit: boolean;
    timeSensitiveFeeBehavior: string | null;
    requiresConservativeAnchor: boolean;
    metadataCompletenessScore: string;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

export interface VenueMarketProfile {
    id: string;
    venue: CanonicalVenue;
    venueMarketId: string;
    canonicalEventId: string;
    title: string;
    description: string | null;
    marketType: string | null;
    marketClass: CanonicalMarketClass;
    outcomes: readonly CanonicalOutcomeDefinition[];
    outcomeSchema: Readonly<Record<string, unknown>>;
    topics: readonly string[];
    category: CanonicalCategory;
    publishedAt: Date | null;
    expiresAt: Date | null;
    resolvesAt: Date | null;
    fees: CanonicalFeeProfile;
    feeModel: string | null;
    resolutionSource: string | null;
    resolutionTitle: string | null;
    resolutionRulesText: string | null;
    network: string | null;
    chain: string | null;
    rawSourcePayload: Readonly<Record<string, unknown>>;
    normalizedPayload: Readonly<Record<string, unknown>>;
    mappingLineage: readonly string[];
    confidenceScore: string;
    sourceMetadataVersion: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface PropositionFingerprint {
    id: string;
    venueMarketProfileId: string;
    subject: string;
    condition: string;
    timeBoundary: string;
    marketClass: CanonicalMarketClass;
    normalizedOutcomeSchema: Readonly<Record<string, unknown>>;
    normalizedPropositionText: string;
    groupingHints: Readonly<Record<string, unknown>>;
    ambiguityFlags: {
        ambiguousTimeBoundary: boolean;
        ambiguousSourceReference: boolean;
        ambiguousJurisdictionOrScope: boolean;
    };
    confidenceScore: string;
    broadFingerprintKey: string;
    strictFingerprintKey: string;
    fingerprintHash: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CanonicalEvent {
    id: string;
    propositionKey: string;
    title: string;
    normalizedPropositionText: string;
    category: CanonicalCategory;
    marketClass: CanonicalMarketClass;
    propositionConfidenceScore: string;
    startsAt: Date | null;
    expiresAt: Date | null;
    resolvesAt: Date | null;
    sourceHints: Readonly<Record<string, unknown>>;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

export interface CompatibilityEdge {
    id: string;
    canonicalEventId: string;
    marketAProfileId: string;
    marketBProfileId: string;
    compatibilityClass: CompatibilityClass;
    reasons: readonly string[];
    propositionSimilarityScore: string;
    outcomeSchemaCompatibilityScore: string;
    timingCompatibilityScore: string;
    resolutionRiskScore: string;
    settlementRiskScore: string;
    structureRiskScore: string;
    feeCompatibilityScore: string;
    confidenceScore: string;
    capitalLockHours: string | null;
    maxSettlementDelayHours: string | null;
    liquidityCostModelVersion: string | null;
    liquidityCostBps: string | null;
    anchoredFinalityHours: string | null;
    requiresConservativeSettlementAnchor: boolean;
    factorBreakdown: Readonly<Record<string, unknown>>;
    scoringVersion: string;
    computedAt: Date;
}

export interface CanonicalExecutableMarket {
    id: string;
    canonicalEventId: string;
    displayName: string;
    marketClass: CanonicalMarketClass;
    compatibilityPolicy: "EQUIVALENT_ONLY";
    riskClass: CompatibilityClass;
    memberProfileIds: readonly string[];
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

const stableHash = (input: string): string => createHash("sha256").update(input).digest("hex");

export const buildStableUuid = (input: string): string => {
    const hex = stableHash(input).slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
    return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export const buildStableTextId = (prefix: string, input: string): string =>
    `${prefix}${stableHash(input).slice(0, 24)}`;

export const normalizeWhitespace = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

export const normalizeFreeText = (value: string): string =>
    normalizeWhitespace(
        value
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
    );

export const sortJsonValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map((entry) => sortJsonValue(entry));
    }

    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, sortJsonValue(entry)])
        );
    }

    return value;
};

export const canonicalizeJsonRecord = (value: Record<string, unknown>): Record<string, unknown> =>
    sortJsonValue(value) as Record<string, unknown>;

export const serializeStableRecord = (value: Record<string, unknown>): string =>
    JSON.stringify(canonicalizeJsonRecord(value));

export const clampRatioString = (value: number): string => {
    if (!Number.isFinite(value)) {
        return "0";
    }
    if (value <= 0) {
        return "0";
    }
    if (value >= 1) {
        return "1";
    }
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
};

export const normalizeCategory = (value: string | null | undefined): CanonicalCategory => {
    switch ((value ?? "").trim().toUpperCase()) {
        case "SPORTS":
        case "CRYPTO":
        case "POLITICS":
        case "ESPORTS":
        case "POP_CULTURE":
        case "ECONOMICS":
            return (value ?? "").trim().toUpperCase() as CanonicalCategory;
        default:
            return "OTHER";
    }
};

export const normalizeMarketClass = (value: string | null | undefined): CanonicalMarketClass => {
    switch ((value ?? "").trim().toUpperCase()) {
        case "BINARY":
        case "CATEGORICAL":
        case "SCALAR":
        case "MULTI_OUTCOME":
            return (value ?? "").trim().toUpperCase() as CanonicalMarketClass;
        default:
            return "UNKNOWN";
    }
};
