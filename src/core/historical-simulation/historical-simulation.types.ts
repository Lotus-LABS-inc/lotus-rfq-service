export enum HistoricalMarketClass {
    BINARY = "BINARY"
}

export type HistoricalCanonicalCategory = "SPORTS" | "CRYPTO" | "OTHER";

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
    venuePair: string;
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
    venuePair: string;
    marketClass: HistoricalMarketClass;
    startedAt?: Date;
    endedAt?: Date | null;
    status: HistoricalSimulationRunStatus;
    metadata?: Record<string, unknown>;
}

export interface HistoricalSimulationRequest {
    scopeType: string;
    scopeId: string;
    venuePair: string;
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
