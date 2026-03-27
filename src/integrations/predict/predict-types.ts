export const PredictEnvironmentValues = ["mainnet", "testnet"] as const;
export type PredictEnvironment = (typeof PredictEnvironmentValues)[number];

export const PredictSimulationPrecisionValues = [
  "REALIZED",
  "RECORDED_HISTORICAL",
  "ESTIMATED_CONSERVATIVE",
  "INSUFFICIENT_DATA"
] as const;
export type PredictSimulationPrecision = (typeof PredictSimulationPrecisionValues)[number];

export const PredictSimulationProvenanceValues = [
  "NATIVE_PREDICT",
  "PREDExON_FALLBACK",
  "MIXED_WITH_PROVENANCE"
] as const;
export type PredictSimulationProvenance = (typeof PredictSimulationProvenanceValues)[number];

export interface PredictOrderbookLevel {
  price: string;
  size: string;
  raw: Record<string, unknown>;
}

export interface PredictNormalizedMarketStatistics {
  volume: string | null;
  liquidity: string | null;
  openInterest: string | null;
  feeRateBps: string | null;
  raw: Record<string, unknown>;
}

export interface PredictNormalizedLastSale {
  price: string | null;
  size: string | null;
  timestamp: Date | null;
  raw: Record<string, unknown>;
}

export interface PredictNormalizedMarket {
  venue: "PREDICT";
  environment: PredictEnvironment;
  venueMarketId: string;
  title: string;
  description: string | null;
  status: string | null;
  categories: readonly string[];
  tags: readonly string[];
  chainId: string | null;
  contractAddress: string | null;
  tokenId: string | null;
  outcomes: readonly {
    id: string;
    label: string;
    tokenId: string | null;
    outcomeType: string | null;
    raw: Record<string, unknown>;
  }[];
  statistics: PredictNormalizedMarketStatistics | null;
  lastSale: PredictNormalizedLastSale | null;
  sourceMetadataVersion: string;
  raw: Record<string, unknown>;
}

export interface PredictNormalizedOrderbookSnapshot {
  venue: "PREDICT";
  environment: PredictEnvironment;
  marketId: string;
  sourceTimestamp: Date | null;
  bids: readonly PredictOrderbookLevel[];
  asks: readonly PredictOrderbookLevel[];
  bestBid: string | null;
  bestAsk: string | null;
  spread: string | null;
  midpoint: string | null;
  topOfBookSize: string | null;
  raw: Record<string, unknown>;
}

export interface PredictNormalizedExecutionEvent {
  venue: "PREDICT";
  environment: PredictEnvironment;
  kind: "MATCH" | "ORDER" | "ACCOUNT_ACTIVITY";
  eventId: string;
  marketId: string | null;
  orderHash: string | null;
  side: string | null;
  price: string | null;
  size: string | null;
  timestamp: Date | null;
  raw: Record<string, unknown>;
}

export interface PredictRecorderCheckpoint {
  recorderType: "ORDERBOOK" | "MATCH_EVENT";
  environment: PredictEnvironment;
  marketId: string;
  checkpointKey: string;
  sequence: number;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface PredictFallbackAvailability {
  documentedAvailability: boolean;
  available: boolean;
  reason: string | null;
}

export interface PredictFallbackSnapshot {
  environment: PredictEnvironment;
  marketId: string;
  timestamp: Date;
  provenance: PredictSimulationProvenance;
  fidelity: "ORDERBOOK" | "TRADE_ONLY" | "COARSE";
  snapshot: Record<string, unknown>;
}

export interface PredictSimulationSurface {
  market: PredictNormalizedMarket | null;
  currentOrderbook: PredictNormalizedOrderbookSnapshot | null;
  recordedOrderbooks: readonly PredictNormalizedOrderbookSnapshot[];
  recordedMatchEvents: readonly PredictNormalizedExecutionEvent[];
  realizedMatchEvents: readonly PredictNormalizedExecutionEvent[];
  accountActivity: readonly PredictNormalizedExecutionEvent[];
  fallbackSnapshots: readonly PredictFallbackSnapshot[];
  precision: PredictSimulationPrecision;
  provenance: PredictSimulationProvenance;
  metadata: Record<string, unknown>;
}

export interface PredictSizeEstimate {
  sizeBucket: "small" | "medium" | "large" | "oversized";
  estimatedEffectiveCost: string | null;
  estimatedSlippage: string | null;
  fillabilityConfidence: string | null;
  precision: PredictSimulationPrecision;
  provenance: PredictSimulationProvenance;
  rationale: string;
  metadata: Record<string, unknown>;
}

export const PREDICT_MAINNET_BASE_URL = "https://api.predict.fun/";
export const PREDICT_TESTNET_BASE_URL = "https://api-testnet.predict.fun/";
