import type {
  CanonicalCategory,
  CanonicalMarketClass,
  CanonicalVenue
} from "../canonical/canonicalization-types.js";

export type MarketDiscoveryState = "DISCOVERED" | "INGESTED" | "APPROVED" | "REJECTED" | "SUPPRESSED";
export type MarketDiscoveryCandidateType = "NEW_DISCOVERY" | "MERGE_SUGGESTION" | "ENRICHMENT_ONLY" | "LOW_CONFIDENCE";
export type MarketDiscoverySourceKind = "UPSTREAM_VENUE" | "EXISTING_INVENTORY" | "MIXED";
export type MarketDiscoveryLifecycleState = "OPEN" | "CLOSED";

export interface MarketDiscoveryDraftSemanticCore {
  category: CanonicalCategory;
  proposedEventTitle: string;
  marketFamily: string | null;
  subject: string | null;
  condition: string | null;
  timeBoundary: string | null;
  marketClass: CanonicalMarketClass;
  normalizedOutcomes: readonly string[];
  venueMembers: readonly {
    venue: CanonicalVenue;
    venueMarketId: string;
    title: string;
    sourceUrl: string | null;
  }[];
  missingFields: readonly string[];
}

export interface MarketDiscoveryMatchDimensions {
  eventTitle: boolean;
  category: boolean;
  marketFamily: boolean;
  subject: boolean;
  condition: boolean;
  timeBoundary: boolean;
  outcomes: boolean;
  rulesSource: boolean;
  venueCount: boolean;
}

export interface VenueMarketDiscoverySnapshot {
  id: string;
  venue: CanonicalVenue;
  venueMarketId: string;
  active: boolean;
  title: string;
  normalizedTitle: string;
  category: CanonicalCategory;
  marketClass: CanonicalMarketClass;
  outcomes: readonly string[];
  semanticBoundaryKey: string | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
  rulesText: string | null;
  resolutionSource: string | null;
  slug: string | null;
  sourceUrl: string | null;
  tokenIds: readonly string[];
  quoteReady: boolean;
  executionReady: boolean;
  sourceHash: string;
  sourceKind: "UPSTREAM_VENUE";
  rawSummary: Readonly<Record<string, unknown>>;
}

export interface NormalizedVenueMarketCandidate {
  venueMarketProfileId: string;
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  sourceKind: MarketDiscoverySourceKind;
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  eventTitle: string;
  normalizedEventTitle: string;
  category: CanonicalCategory;
  marketClass: CanonicalMarketClass;
  semanticBoundaryKey: string | null;
  outcomes: readonly string[];
  rulesText: string | null;
  sourceUrl: string | null;
  quoteReady: boolean;
  executionReady: boolean;
  evidenceLabel: string;
  historicalRowCount: number;
  marketFamily: string | null;
  subject: string | null;
  condition: string | null;
  topicTitle: string;
  topicKey: string;
  contractLabel: string | null;
  contractKey: string | null;
  sideLabels: readonly string[];
  semanticReasonCodes: readonly string[];
}

export interface MarketDiscoveryVenueEvidence {
  venueMarketProfileId: string;
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  outcomes: readonly string[];
  quoteReady: boolean;
  executionReady: boolean;
  evidenceLabel: string;
  historicalRowCount: number;
}

export interface MarketDiscoveryCandidate {
  id: string;
  candidateKey: string;
  state: MarketDiscoveryState;
  lifecycleState: MarketDiscoveryLifecycleState;
  candidateType: MarketDiscoveryCandidateType;
  sourceKind: MarketDiscoverySourceKind;
  eventTitle: string;
  normalizedEventTitle: string;
  category: CanonicalCategory;
  marketClass: CanonicalMarketClass;
  semanticBoundaryKey: string | null;
  venueCount: number;
  sharedOutcomeCount: number;
  confidenceScore: number;
  reasonCodes: readonly string[];
  noveltySummary: Readonly<Record<string, unknown>>;
  draftSemanticCore: MarketDiscoveryDraftSemanticCore | null;
  matchDimensions: MarketDiscoveryMatchDimensions;
  unsafeGroupingWarnings: readonly string[];
  approvalActions: readonly string[];
  routingReview: {
    exactPromotionIds: readonly string[];
    nearExactMatchIds: readonly string[];
  };
  archiveEligibility: {
    eligible: boolean;
    reason: string;
    eligibleAfter: string | null;
  };
  venues: readonly CanonicalVenue[];
  sharedOutcomes: readonly string[];
  missingOutcomes: readonly {
    venue: CanonicalVenue;
    missing: readonly string[];
  }[];
  venueEvidence: readonly MarketDiscoveryVenueEvidence[];
  metadata: Readonly<Record<string, unknown>>;
}

export type MarketDiscoveryCoverageKind = "SINGLE" | "PAIR" | "TRI" | "MULTI";

export interface MarketDiscoveryTopicBundleChild {
  candidateId: string;
  candidateKey: string;
  state: MarketDiscoveryState;
  lifecycleState: MarketDiscoveryLifecycleState;
  candidateType: MarketDiscoveryCandidateType;
  eventTitle: string;
  contractLabel: string | null;
  contractKey: string | null;
  venues: readonly CanonicalVenue[];
  venueCount: number;
  coverageKind: MarketDiscoveryCoverageKind;
  confidenceScore: number;
  sharedOutcomes: readonly string[];
  missingVenueEvidence: readonly string[];
  approvalActions: readonly string[];
  routingReview: {
    exactPromotionIds: readonly string[];
    nearExactMatchIds: readonly string[];
  };
  archiveEligibility: {
    eligible: boolean;
    reason: string;
    eligibleAfter: string | null;
  };
}

export interface MarketDiscoveryTopicBundle {
  bundleKey: string;
  topicTitle: string;
  topicKey: string;
  category: CanonicalCategory;
  marketFamily: string | null;
  subject: string | null;
  condition: string | null;
  timeBoundary: string | null;
  venues: readonly CanonicalVenue[];
  contractCount: number;
  ingestedChildCount: number;
  lowConfidenceChildCount: number;
  discoveredChildCount: number;
  approvedChildCount: number;
  rejectedChildCount: number;
  missingVenueEvidence: readonly string[];
  children: readonly MarketDiscoveryTopicBundleChild[];
}

export interface MarketDiscoveryRunSummary {
  observedAt: string;
  inventoryRows: number;
  activeRows: number;
  upstreamRows: number;
  candidateCount: number;
  newDiscoveryCount: number;
  mergeSuggestionCount: number;
  enrichmentOnlyCount: number;
  lowConfidenceCount: number;
  discoveredCount: number;
  ingestedCount: number;
  persistedCount: number;
  snapshotPersistedCount: number;
  staleRetiredCount: number;
  upstreamRowsByVenueCategory: Readonly<Record<string, number>>;
  lowConfidenceMissingFieldCounts: Readonly<Record<string, number>>;
  venueStatuses: Readonly<Record<string, {
    status: "SUCCESS" | "EMPTY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
    rowCount: number;
    warningCount: number;
  }>>;
}
