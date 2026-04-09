export type LimitlessBtcDirectionalSurfaceName =
  | "limitless-live-market-loader"
  | "limitless-live-market-loader-snapshot-fallback"
  | "limitless-client-market-detail"
  | "limitless-client-market-events"
  | "limitless-client-historical-price"
  | "ingest-limitless-live-markets.job"
  | "btc-limitless-counterpart-proof-audit"
  | "btc-venue-audit-sources";

export interface LimitlessBtcDirectionalDiscoverySurface {
  surfaceName: LimitlessBtcDirectionalSurfaceName;
  codePath: string;
  authMode: "PUBLIC" | "AUTHENTICATED";
  temporalMode: "LIVE_CURRENT_STATE" | "HISTORICAL" | "MIXED";
  payloadMode: "DISCOVERY" | "STATE" | "EVENTS" | "DETAIL" | "ENRICHMENT";
  structuralFields: readonly string[];
  alreadyConsumedByLotus: boolean;
  strength: "STRONG" | "PARTIAL" | "WEAK";
  limitations: readonly string[];
}

export interface LimitlessBtcDirectionalDiscoveryMap {
  observedAt: string;
  surfaces: readonly LimitlessBtcDirectionalDiscoverySurface[];
  authoritativeDiscoverySurface: string | null;
  authenticatedEnrichmentAvailable: boolean;
}

export interface LimitlessBtcDirectionalExcludedRow {
  surface: string;
  venueMarketId: string;
  title: string;
  reasons: readonly string[];
}

export interface LimitlessBtcDirectionalCandidate {
  venueMarketId: string;
  rawTitle: string;
  normalizedTitle: string;
  asset: string;
  family: "SAME_DAY_DIRECTIONAL";
  familyConfidence: string;
  comparator: string | null;
  date: string;
  cutoffTimestamp: string | null;
  timezoneNormalizedCutoff: string | null;
  bucketGranularity: string | null;
  observationType: string | null;
  binaryStructure: string | null;
  sourceSurfaces: readonly string[];
  discoveryTimestamp: string;
  currentlyActive: boolean;
  ambiguityFlags: readonly string[];
}

export interface LimitlessBtcDirectionalInventoryArtifact {
  observedAt: string;
  reachableSurfaceCount: number;
  authenticatedEnrichmentAttempted: boolean;
  candidates: readonly LimitlessBtcDirectionalCandidate[];
  exclusions: readonly LimitlessBtcDirectionalExcludedRow[];
}

export type LimitlessBtcDirectionalAlignmentBlocker =
  | "NO_LIMITLESS_COUNTERPART"
  | "DATE_MISMATCH"
  | "CUTOFF_MISMATCH"
  | "OBSERVATION_TYPE_MISMATCH"
  | "BUCKET_GRANULARITY_MISMATCH"
  | "STRUCTURE_MISMATCH"
  | "ASSET_NOT_CONFIRMED"
  | "FAMILY_NOT_CONFIRMED"
  | "SURFACE_INSUFFICIENT";

export interface LimitlessBtcDirectionalKnownWindow {
  venue: "POLYMARKET" | "OPINION";
  venueMarketId: string;
  title: string;
  exactWindowKey: string;
  date: string | null;
  cutoffTimestamp: string | null;
  timezoneNormalizedCutoff: string | null;
  bucketGranularity: string | null;
  observationType: string | null;
  binaryStructure: string | null;
}

export interface LimitlessBtcDirectionalAlignmentRow {
  knownWindow: LimitlessBtcDirectionalKnownWindow;
  blocker: LimitlessBtcDirectionalAlignmentBlocker;
  exactSafeComparable: boolean;
  matchedLimitlessMarketId: string | null;
  rationale: string;
}

export interface LimitlessBtcDirectionalAlignmentMatrix {
  observedAt: string;
  knownWindows: readonly LimitlessBtcDirectionalKnownWindow[];
  limitlessCandidateCount: number;
  rows: readonly LimitlessBtcDirectionalAlignmentRow[];
}

export type LimitlessBtcDirectionalDecisionLabel =
  | "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__DISCOVERY_PATH_INCOMPLETE"
  | "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__INGESTION_ADAPTER_NEXT"
  | "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_NOT_PROVEN_ON_CURRENT_SURFACES"
  | "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_ABSENT_IN_EXACT_SAFE_WINDOWS";

export interface LimitlessBtcDirectionalDecisionArtifact {
  observedAt: string;
  decision: LimitlessBtcDirectionalDecisionLabel;
  exactSafeCounterpartExists: boolean;
  rationale: string;
}

export interface LimitlessBtcDirectionalNextStepPlanArtifact {
  observedAt: string;
  decision: LimitlessBtcDirectionalDecisionLabel;
  actions: readonly {
    step: string;
    owner: string;
    modules: readonly string[];
    fields: readonly string[];
    reruns: readonly string[];
  }[];
}

export interface LimitlessBtcDirectionalSourceHygieneSummary {
  observedAt: string;
  rejectedCount: number;
  reasons: Record<string, number>;
  examples: readonly LimitlessBtcDirectionalExcludedRow[];
  earlyFilterTighteningRecommended: boolean;
}
