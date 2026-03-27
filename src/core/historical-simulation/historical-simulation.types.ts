export enum HistoricalMarketClass {
    BINARY = "BINARY"
}

export type HistoricalCanonicalCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | "OTHER";
export type HistoricalSimulationOrderSide = "BUY" | "SELL";
export type HistoricalSimulationRouteCardinality = "single" | "pair" | "tri";
export const HistoricalSimulationCatalogScopeValues = ["live", "historical_simulation"] as const;
export type HistoricalSimulationCatalogScope = (typeof HistoricalSimulationCatalogScopeValues)[number];
export type HistoricalSimulationRouteAvailabilityReason =
    | "missing_required_venue"
    | "missing_historical_rows"
    | "missing_pair_assessment"
    | "incomplete_resolution_risk"
    | "stale_resolution_risk"
    | "unsafe_equivalence"
    | "ambiguous_venue_identity";

export const HistoricalSimulationRouteModeValues = [
    "POLYMARKET_ONLY",
    "LIMITLESS_ONLY",
    "OPINION_ONLY",
    "MYRIAD_ONLY",
    "PREDICT_ONLY",
    "POLYMARKET_LIMITLESS",
    "POLYMARKET_OPINION",
    "LIMITLESS_OPINION",
    "POLYMARKET_LIMITLESS_OPINION",
    "POLYMARKET_PREDICT",
    "LIMITLESS_PREDICT",
    "OPINION_PREDICT"
] as const;

export type HistoricalSimulationRouteMode = (typeof HistoricalSimulationRouteModeValues)[number];

export interface HistoricalSimulationRouteModeDefinition {
    mode: HistoricalSimulationRouteMode;
    label: string;
    cardinality: HistoricalSimulationRouteCardinality;
    requiredVenues: readonly string[];
}

export const HistoricalSimulationRouteModeDefinitions: readonly HistoricalSimulationRouteModeDefinition[] = [
    {
        mode: "POLYMARKET_ONLY",
        label: "Predexon Only",
        cardinality: "single",
        requiredVenues: ["POLYMARKET"]
    },
    {
        mode: "LIMITLESS_ONLY",
        label: "Limitless Only",
        cardinality: "single",
        requiredVenues: ["LIMITLESS"]
    },
    {
        mode: "OPINION_ONLY",
        label: "Opinion Only",
        cardinality: "single",
        requiredVenues: ["OPINION"]
    },
    {
        mode: "MYRIAD_ONLY",
        label: "Myriad Only",
        cardinality: "single",
        requiredVenues: ["MYRIAD"]
    },
    {
        mode: "PREDICT_ONLY",
        label: "Predict Only",
        cardinality: "single",
        requiredVenues: ["PREDICT"]
    },
    {
        mode: "POLYMARKET_LIMITLESS",
        label: "Predexon + Limitless",
        cardinality: "pair",
        requiredVenues: ["POLYMARKET", "LIMITLESS"]
    },
    {
        mode: "POLYMARKET_OPINION",
        label: "Predexon + Opinion",
        cardinality: "pair",
        requiredVenues: ["POLYMARKET", "OPINION"]
    },
    {
        mode: "LIMITLESS_OPINION",
        label: "Limitless + Opinion",
        cardinality: "pair",
        requiredVenues: ["LIMITLESS", "OPINION"]
    },
    {
        mode: "POLYMARKET_LIMITLESS_OPINION",
        label: "Predexon + Limitless + Opinion",
        cardinality: "tri",
        requiredVenues: ["POLYMARKET", "LIMITLESS", "OPINION"]
    },
    {
        mode: "POLYMARKET_PREDICT",
        label: "Predexon + Predict",
        cardinality: "pair",
        requiredVenues: ["POLYMARKET", "PREDICT"]
    },
    {
        mode: "LIMITLESS_PREDICT",
        label: "Limitless + Predict",
        cardinality: "pair",
        requiredVenues: ["LIMITLESS", "PREDICT"]
    },
    {
        mode: "OPINION_PREDICT",
        label: "Opinion + Predict",
        cardinality: "pair",
        requiredVenues: ["OPINION", "PREDICT"]
    }
] as const;

export const getHistoricalSimulationRouteModeDefinition = (
    routeMode: HistoricalSimulationRouteMode
): HistoricalSimulationRouteModeDefinition =>
    HistoricalSimulationRouteModeDefinitions.find((definition) => definition.mode === routeMode)
        ?? HistoricalSimulationRouteModeDefinitions[0]!;

export const resolveHistoricalSimulationRouteModeVenues = (
    routeMode: HistoricalSimulationRouteMode
): readonly string[] => getHistoricalSimulationRouteModeDefinition(routeMode).requiredVenues;

export enum HistoricalSimulationRunStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    SUCCEEDED = "SUCCEEDED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}

export interface HistoricalVenueAdapter {
    venue: string;
    marketClass: HistoricalMarketClass;
    supportsCandles: boolean;
    supportsOrderbookHistory: boolean;
    supportsTradesHistory: boolean;
    supportsOwnExecutionHistory: boolean;
    metadataVersion: string;
}

export interface HistoricalMarketState {
    id: string;
    canonicalEventId: string;
    canonicalMarketId: string | null;
    canonicalCategory: HistoricalCanonicalCategory | null;
    venue: string;
    venueMarketId: string;
    marketClass: HistoricalMarketClass;
    timestamp: Date;
    midpoint: string | null;
    bestBid: string | null;
    bestAsk: string | null;
    spread: string | null;
    lastPrice: string | null;
    volume: string | null;
    openInterest: string | null;
    candles: Record<string, unknown> | null;
    orderbookSnapshot: Record<string, unknown> | null;
    marketEvents: Record<string, unknown> | null;
    trades: Record<string, unknown> | null;
    ownExecutionHistory: Record<string, unknown> | null;
    metadataVersion: string;
    sourceTimestamp: Date;
}

export interface CreateHistoricalMarketStateInput {
    id?: string;
    canonicalEventId: string;
    canonicalMarketId?: string | null;
    canonicalCategory?: HistoricalCanonicalCategory | null;
    venue: string;
    venueMarketId: string;
    marketClass: HistoricalMarketClass;
    timestamp: Date;
    midpoint?: string | null;
    bestBid?: string | null;
    bestAsk?: string | null;
    spread?: string | null;
    lastPrice?: string | null;
    volume?: string | null;
    openInterest?: string | null;
    candles?: Record<string, unknown> | null;
    orderbookSnapshot?: Record<string, unknown> | null;
    marketEvents?: Record<string, unknown> | null;
    trades?: Record<string, unknown> | null;
    ownExecutionHistory?: Record<string, unknown> | null;
    metadataVersion: string;
    sourceTimestamp: Date;
}

export interface HistoricalSimulationRun {
    id: string;
    qualificationRunId: string | null;
    scopeType: string;
    scopeId: string;
    routeMode: HistoricalSimulationRouteMode;
    marketClass: HistoricalMarketClass;
    startedAt: Date;
    endedAt: Date | null;
    status: HistoricalSimulationRunStatus;
    metadata: Record<string, unknown>;
}

export interface CreateHistoricalSimulationRunInput {
    id?: string;
    qualificationRunId?: string | null;
    scopeType: string;
    scopeId: string;
    routeMode: HistoricalSimulationRouteMode;
    marketClass: HistoricalMarketClass;
    startedAt?: Date;
    endedAt?: Date | null;
    status: HistoricalSimulationRunStatus;
    metadata?: Record<string, unknown>;
}

export interface HistoricalSimulationRequest {
    scopeType: string;
    scopeId: string;
    routeMode: HistoricalSimulationRouteMode;
    marketClass: HistoricalMarketClass;
    canonicalEventId: string;
    startTimestamp: Date;
    endTimestamp: Date;
    metadata?: Record<string, unknown>;
}

export interface HistoricalSimulationResult {
    id: string;
    runId: string;
    canonicalEventId: string;
    timestamp: Date;
    baselineResults: Record<string, unknown>;
    lotusResult: Record<string, unknown>;
    improvement: Record<string, unknown>;
    rolloutEligibility: Record<string, unknown>;
    createdAt: Date;
}

export interface CreateHistoricalSimulationResultInput {
    id?: string;
    runId: string;
    canonicalEventId: string;
    timestamp: Date;
    baselineResults: Record<string, unknown>;
    lotusResult: Record<string, unknown>;
    improvement: Record<string, unknown>;
    rolloutEligibility: Record<string, unknown>;
    createdAt?: Date;
}

export interface PairedMarketIdentity {
    venue: string;
    venueMarketId: string;
    title: string | null;
}

export interface CanonicalMarketOption {
    canonicalMarketId: string;
    isRunnable: boolean;
    venues: ReadonlyArray<PairedMarketIdentity>;
    routeModes: ReadonlyArray<HistoricalSimulationRouteAvailability>;
    runnableRouteModes: ReadonlyArray<HistoricalSimulationRouteMode>;
}

export interface HistoricalSimulationRouteAvailability {
    routeMode: HistoricalSimulationRouteMode;
    label: string;
    cardinality: HistoricalSimulationRouteCardinality;
    requiredVenues: readonly string[];
    runnable: boolean;
    reason: HistoricalSimulationRouteAvailabilityReason | null;
}

export interface HistoricalSimulationEventRouteSummary {
    routeMode: HistoricalSimulationRouteMode;
    label: string;
    cardinality: HistoricalSimulationRouteCardinality;
    routeableMarketCount: number;
    hasAnyRoute: boolean;
}

export interface HistoricalSimulationCatalogContext {
    catalogScope: HistoricalSimulationCatalogScope;
}

export interface HistoricalRoutedVenueAllocation {
    venue: string;
    venueMarketId: string;
    price: string;
    quantity: string;
    requestedNotional: string;
    filledNotional: string;
    fillRatio: string | null;
    priceSource: string;
    depthSource: string;
    fillProbability: string | null;
    fillProbabilityReason: string | null;
    isProvable: boolean;
    isResidualUnknownDepth: boolean;
}

export interface HistoricalRoutedExecutionPlan {
    planType: "SINGLE_WINNER" | "MULTI_SPLIT";
    side: HistoricalSimulationOrderSide;
    requestedNotional: string;
    requestedQuantity: string;
    filledNotional: string;
    filledQuantity: string;
    provableFilledNotional: string;
    provableFilledQuantity: string;
    provableFillRatio: string;
    residualNotional: string;
    residualQuantity: string;
    unprovenResidualNotional: string;
    unprovenResidualQuantity: string;
    fillRatio: string;
    averageExecutionPrice: string | null;
    effectiveCost: string;
    slippage: string;
    fees: string;
    fillProbability: string | null;
    fillProbabilityReason: string | null;
    containsUnknownDepth: boolean;
    allocations: ReadonlyArray<HistoricalRoutedVenueAllocation>;
    metadata: Record<string, unknown>;
}

export interface HistoricalRoutingComparison {
    selectedPlan: HistoricalRoutedExecutionPlan;
    alternatePlan: HistoricalRoutedExecutionPlan;
    comparisonReason: string;
    comparisonBasis: "provable_fill_ratio" | "economic_cost" | "fewer_allocations" | "stable_plan_order";
}
