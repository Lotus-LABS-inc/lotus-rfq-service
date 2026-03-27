import type {
  PredictFallbackSnapshot,
  PredictNormalizedExecutionEvent,
  PredictNormalizedMarket,
  PredictNormalizedOrderbookSnapshot,
  PredictSimulationPrecision,
  PredictSimulationProvenance,
  PredictSimulationSurface
} from "../../integrations/predict/predict-types.js";

export interface BuildPredictSimulationSurfaceInput {
  market: PredictNormalizedMarket | null;
  currentOrderbook: PredictNormalizedOrderbookSnapshot | null;
  recordedOrderbooks?: readonly PredictNormalizedOrderbookSnapshot[];
  recordedMatchEvents?: readonly PredictNormalizedExecutionEvent[];
  realizedMatchEvents?: readonly PredictNormalizedExecutionEvent[];
  accountActivity?: readonly PredictNormalizedExecutionEvent[];
  fallbackSnapshots?: readonly PredictFallbackSnapshot[];
}

const determinePrecision = (input: BuildPredictSimulationSurfaceInput): PredictSimulationPrecision => {
  if ((input.recordedOrderbooks?.length ?? 0) > 0 && (input.recordedMatchEvents?.length ?? 0) > 0) {
    return "RECORDED_HISTORICAL";
  }
  if ((input.realizedMatchEvents?.length ?? 0) > 0) {
    return "REALIZED";
  }
  if ((input.fallbackSnapshots?.length ?? 0) > 0) {
    const hasOrderbookFidelity = input.fallbackSnapshots?.some((snapshot) => snapshot.fidelity === "ORDERBOOK") ?? false;
    return hasOrderbookFidelity ? "RECORDED_HISTORICAL" : "ESTIMATED_CONSERVATIVE";
  }
  if (input.currentOrderbook !== null) {
    return "ESTIMATED_CONSERVATIVE";
  }
  return "INSUFFICIENT_DATA";
};

const determineProvenance = (input: BuildPredictSimulationSurfaceInput): PredictSimulationProvenance => {
  const hasNative =
    input.currentOrderbook !== null ||
    (input.recordedOrderbooks?.length ?? 0) > 0 ||
    (input.recordedMatchEvents?.length ?? 0) > 0 ||
    (input.realizedMatchEvents?.length ?? 0) > 0;
  const hasFallback = (input.fallbackSnapshots?.length ?? 0) > 0;
  if (hasNative && hasFallback) {
    return "MIXED_WITH_PROVENANCE";
  }
  return hasFallback ? "PREDExON_FALLBACK" : "NATIVE_PREDICT";
};

export const buildPredictSimulationSurface = (input: BuildPredictSimulationSurfaceInput): PredictSimulationSurface => {
  const precision = determinePrecision(input);
  const provenance = determineProvenance(input);
  return {
    market: input.market,
    currentOrderbook: input.currentOrderbook,
    recordedOrderbooks: input.recordedOrderbooks ?? [],
    recordedMatchEvents: input.recordedMatchEvents ?? [],
    realizedMatchEvents: input.realizedMatchEvents ?? [],
    accountActivity: input.accountActivity ?? [],
    fallbackSnapshots: input.fallbackSnapshots ?? [],
    precision,
    provenance,
    metadata: {
      nativeRecordedOrderbooks: input.recordedOrderbooks?.length ?? 0,
      nativeRecordedMatchEvents: input.recordedMatchEvents?.length ?? 0,
      nativeRealizedMatchEvents: input.realizedMatchEvents?.length ?? 0,
      fallbackSnapshots: input.fallbackSnapshots?.length ?? 0
    }
  };
};
