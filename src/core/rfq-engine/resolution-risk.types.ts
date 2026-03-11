export type ResolutionEquivalenceClass =
    | "SAFE_EQUIVALENT"
    | "CAUTION"
    | "HIGH_RISK"
    | "DO_NOT_POOL";

export interface CanonicalResolutionMarketInput {
    canonicalMarketId: string;
    canonicalEventId: string;
    venue: string;
    venueMarketId: string;
}

export interface FlatResolutionVenueMetadata {
    shape: "flat";
    oracleType?: string;
    oracleName?: string;
    resolutionAuthorityType?: string;
    primaryResolutionText?: string;
    supplementalRulesText?: string;
    disputeWindowHours?: string | number | null;
    settlementLagHours?: string | number | null;
    marketType?: string;
    outcomeSchema?: Record<string, unknown> | null;
    hasAmbiguousTimeBoundary?: boolean;
    hasAmbiguousJurisdictionBoundary?: boolean;
    hasAmbiguousSourceReference?: boolean;
    historicalDivergenceRate?: string | number | null;
    metadata?: Record<string, unknown>;
}

export interface NestedRulesResolutionVenueMetadata {
    shape: "nested_rules";
    oracle?: {
        type?: string;
        name?: string;
    };
    rules?: {
        authorityType?: string;
        primaryText?: string;
        supplementalText?: string;
    };
    timing?: {
        disputeWindowHours?: string | number | null;
        settlementLagHours?: string | number | null;
    };
    market?: {
        type?: string;
        outcomeSchema?: Record<string, unknown> | null;
    };
    ambiguity?: {
        timeBoundary?: boolean;
        jurisdictionBoundary?: boolean;
        sourceReference?: boolean;
    };
    history?: {
        divergenceRate?: string | number | null;
    };
    metadata?: Record<string, unknown>;
}

export interface OracleDocumentResolutionVenueMetadata {
    shape: "oracle_document";
    resolution?: {
        oracle?: {
            type?: string;
            name?: string;
        };
        authority?: {
            type?: string;
        };
        primaryText?: string;
        marketType?: string;
        outcomeSchema?: Record<string, unknown> | null;
    };
    documents?: {
        supplementalRulesText?: string;
    };
    windows?: {
        disputeHours?: string | number | null;
        settlementLagHours?: string | number | null;
    };
    flags?: {
        ambiguousTimeBoundary?: boolean;
        ambiguousJurisdictionBoundary?: boolean;
        ambiguousSourceReference?: boolean;
    };
    stats?: {
        historicalDivergenceRate?: string | number | null;
    };
    metadata?: Record<string, unknown>;
}

export type SupportedResolutionVenueMetadata =
    | FlatResolutionVenueMetadata
    | NestedRulesResolutionVenueMetadata
    | OracleDocumentResolutionVenueMetadata;

export interface ResolutionProfileNormalizerInput {
    market: CanonicalResolutionMarketInput;
    venueMetadata: SupportedResolutionVenueMetadata;
}

export interface NormalizedResolutionProfile {
    id: string;
    venue: string;
    venueMarketId: string;
    canonicalEventId: string;
    oracleType?: string | null;
    oracleName?: string | null;
    resolutionAuthorityType?: string | null;
    primaryResolutionText?: string | null;
    supplementalRulesText?: string | null;
    disputeWindowHours?: string | null;
    settlementLagHours?: string | null;
    marketType?: string | null;
    outcomeSchema?: Record<string, unknown> | null;
    hasAmbiguousTimeBoundary: boolean;
    hasAmbiguousJurisdictionBoundary: boolean;
    hasAmbiguousSourceReference: boolean;
    historicalDivergenceRate?: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export type CreateNormalizedResolutionProfileInput = Omit<
    NormalizedResolutionProfile,
    "id" | "createdAt" | "updatedAt"
>;

export interface ResolutionRiskAssessment {
    id: string;
    canonicalEventId: string;
    marketAProfileId: string;
    marketBProfileId: string;
    riskScore: string;
    confidenceScore: string;
    equivalenceClass: ResolutionEquivalenceClass;
    factorBreakdown: Record<string, unknown>;
    reasons: readonly string[];
    version: string;
    computedAt: Date;
}

export type ResolutionRiskRecommendedAction =
    | "Poolable"
    | "Pool with caution"
    | "Isolate execution"
    | "Do not pool";

export interface ResolutionRiskPresentationModel {
    label: string;
    riskScore: string;
    confidenceScore: string;
    equivalenceClass: ResolutionEquivalenceClass;
    shortReasons: readonly string[];
    factorBreakdown: Record<string, unknown>;
    recommendedAction: ResolutionRiskRecommendedAction;
}

export type CreateResolutionRiskAssessmentInput = Omit<
    ResolutionRiskAssessment,
    "id" | "computedAt"
>;

export interface ResolutionFactorComparison {
    score: number;
    confidence: number;
    reason?: string;
}

export interface ResolutionFactorComparisonResult {
    oracleMismatch: ResolutionFactorComparison;
    ruleMismatch: ResolutionFactorComparison;
    wordingAmbiguity: ResolutionFactorComparison;
    disputeWindowMismatch: ResolutionFactorComparison;
    settlementLagMismatch: ResolutionFactorComparison;
    structuralMismatch: ResolutionFactorComparison;
    historicalDivergence: ResolutionFactorComparison;
}

export interface ResolutionRiskScoringInput {
    canonicalEventId: string;
    marketAProfileId: string;
    marketBProfileId: string;
    factorComparison: ResolutionFactorComparisonResult;
    version: string;
}

export interface ResolutionRiskAssessmentServiceConfig {
    version: string;
}

export interface ResolutionRiskAssessmentMetricsPayload {
    canonicalEventId: string;
    marketAProfileId: string;
    marketBProfileId: string;
    equivalenceClass?: ResolutionEquivalenceClass;
    riskScore?: string;
    confidenceScore?: string;
    version: string;
    errorCode?: string;
}

export interface ResolutionRiskAssessmentMetricsHooks {
    onAssessmentBuilt?: (payload: ResolutionRiskAssessmentMetricsPayload) => void;
    onAssessmentPersisted?: (payload: ResolutionRiskAssessmentMetricsPayload) => void;
    onAssessmentRecomputed?: (payload: {
        canonicalEventId: string;
        profileId: string;
        assessmentCount: number;
        version: string;
    }) => void;
    onAssessmentFailed?: (payload: ResolutionRiskAssessmentMetricsPayload) => void;
}

export interface ResolutionRiskAssessmentPair {
    marketAProfileId: string;
    marketBProfileId: string;
}

export interface ResolutionRiskAssessmentBuildResult {
    canonicalEventId: string;
    version: string;
    assessments: readonly ResolutionRiskAssessment[];
}

export interface ResolutionRiskPairDecision {
    equivalenceClass: ResolutionEquivalenceClass;
    reasons: readonly string[];
}

export interface ResolutionRiskVenueLane {
    laneId: string;
    profileIds: readonly string[];
    type: "SAFE_POOL" | "CAUTION";
}

export interface ResolutionRiskVenueGrouping {
    canonicalEventId: string;
    safePools: readonly (readonly string[])[];
    cautionLanes: readonly (readonly string[])[];
    blockedProfiles: readonly string[];
    reasonsByProfile: Readonly<Record<string, readonly string[]>>;
    pairMatrix: Readonly<Record<string, ResolutionRiskPairDecision>>;
}

export type ResolutionRiskRolloutMode = "disabled" | "shadow" | "enabled";
export type ResolutionRiskPolicyDomain = "rfq" | "sor" | "internal_execution";
export type ResolutionRiskPolicyOutcome = "normal" | "separated" | "penalty" | "isolated_only" | "blocked";
export type ResolutionRiskShadowDivergenceReason =
    | "blocked_vs_allowed"
    | "separated_vs_pooled"
    | "penalty_vs_no_penalty"
    | "excluded_vs_allowed"
    | "missing_assessment"
    | "missing_profile_mapping";

export interface ResolutionRiskShadowDecision {
    outcome: ResolutionRiskPolicyOutcome;
    reason: string;
    equivalenceClass?: ResolutionEquivalenceClass | "UNKNOWN";
}

export interface ResolutionRiskShadowComparison {
    domain: ResolutionRiskPolicyDomain;
    mode: ResolutionRiskRolloutMode;
    enforcementActive: boolean;
    enforcedDecision: ResolutionRiskPolicyOutcome;
    reason: string;
    shadowDecision?: ResolutionRiskShadowDecision;
    divergenceReason?: ResolutionRiskShadowDivergenceReason;
}

export interface ResolutionRiskPolicyDecision extends ResolutionRiskShadowComparison {}
