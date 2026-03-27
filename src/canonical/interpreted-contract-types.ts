import type {
    CanonicalVenue,
    ResolutionProfile,
    SettlementProfile,
    PropositionFingerprint,
    VenueMarketProfile
} from "./canonicalization-types.js";

export interface InterpretedContractAmbiguityFlags {
    ambiguousTimeBoundary: boolean;
    ambiguousSourceReference: boolean;
    ambiguousJurisdictionOrScope: boolean;
    missingCriticalOutcomeSemantics: boolean;
    missingCriticalTimingSemantics: boolean;
    missingCriticalResolutionSemantics: boolean;
}

export interface InterpretedContractSemantics {
    proposition: Readonly<Record<string, unknown>>;
    outcome: Readonly<Record<string, unknown>>;
    timing: Readonly<Record<string, unknown>>;
    resolution: Readonly<Record<string, unknown>>;
    settlement: Readonly<Record<string, unknown>>;
}

export interface InterpretedContract {
    id: string;
    venue: CanonicalVenue;
    venueMarketId: string;
    canonicalEventId: string;
    venueMarketProfileId: string;
    propositionFingerprintId: string;
    resolutionProfileId: string;
    settlementProfileId: string;
    normalizedPropositionSemantics: Readonly<Record<string, unknown>>;
    normalizedOutcomeSemantics: Readonly<Record<string, unknown>>;
    normalizedTimingSemantics: Readonly<Record<string, unknown>>;
    normalizedResolutionSemantics: Readonly<Record<string, unknown>>;
    normalizedSettlementSemantics: Readonly<Record<string, unknown>>;
    ambiguityFlags: InterpretedContractAmbiguityFlags;
    interpretationConfidence: string;
    sourceMetadataVersion: string;
    rawLineageReferences: Readonly<Record<string, unknown>>;
    isPoolable: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface InterpretedContractBuildInput {
    market: VenueMarketProfile;
    fingerprint: PropositionFingerprint;
    resolutionProfile: ResolutionProfile;
    settlementProfile: SettlementProfile;
}
