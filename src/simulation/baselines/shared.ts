import Decimal from "decimal.js";

import type { HistoricalMarketState, HistoricalSimulationOrderSide } from "../../core/historical-simulation/historical-simulation.types.js";

export type HistoricalSimulationBaselineType =
  | "POLYMARKET_ONLY"
  | "LIMITLESS_ONLY"
  | "OPINION_ONLY"
  | "MYRIAD_ONLY"
  | "PREDICT_ONLY"
  | "BEST_EXTERNAL_ONLY"
  | "NO_INTERNALIZATION";

export interface HistoricalSimulationVenueFeePolicy {
  feeBps: string;
  fixedFee?: string;
}

export interface HistoricalSimulationFeePolicy {
  version: string;
  venues: Record<string, HistoricalSimulationVenueFeePolicy>;
}

export interface HistoricalSimulationBaselineInput {
  canonicalEventId: string;
  marketStates: readonly HistoricalMarketState[];
  timelineSliceStart?: Date;
  timelineSliceEnd?: Date;
  side: HistoricalSimulationOrderSide;
  requestedNotional: string;
  feePolicy: HistoricalSimulationFeePolicy;
}

export interface HistoricalSimulationBaselineEstimate {
  venue: string;
  baselineType: HistoricalSimulationBaselineType;
  effectiveCost: string;
  slippage: string;
  fees: string;
  fillProbability: string | null;
  fillProbabilityReason: string | null;
  timestampStart: Date;
  timestampEnd: Date;
  observedStateCount: number;
  metadata: Record<string, unknown>;
}

export type HistoricalSimulationBaselineErrorCode =
  | "invalid_baseline_input"
  | "insufficient_historical_state"
  | "ambiguous_venue_scope"
  | "unsupported_market_shape"
  | "fill_probability_not_inferable";

export class HistoricalSimulationBaselineError extends Error {
  public readonly code: HistoricalSimulationBaselineErrorCode;

  public constructor(code: HistoricalSimulationBaselineErrorCode, message: string) {
    super(message);
    this.name = "HistoricalSimulationBaselineError";
    this.code = code;
  }
}

export interface SelectedHistoricalPriceState {
  state: HistoricalMarketState;
  selectedPrice: InstanceType<typeof Decimal>;
  priceSource: "bestAsk" | "bestBid" | "midpoint" | "lastPrice";
}

export interface FillProbabilityResult {
  fillProbability: string | null;
  fillProbabilityReason: string | null;
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
export const parseDecimal = (value: string | number, fieldName: string): InstanceType<typeof Decimal> => {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) {
      throw new Error("non-finite");
    }
    return parsed;
  } catch {
    throw new HistoricalSimulationBaselineError("invalid_baseline_input", `${fieldName} must be a finite decimal value.`);
  }
};

export const resolveRequestedNotional = (requestedNotional: string): InstanceType<typeof Decimal> => {
  const resolved = parseDecimal(requestedNotional, "requestedNotional");
  if (resolved.lte(0)) {
    throw new HistoricalSimulationBaselineError("invalid_baseline_input", "requestedNotional must be positive.");
  }
  return resolved;
};

export const sortStates = (states: readonly HistoricalMarketState[]): HistoricalMarketState[] =>
  [...states].sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() ||
      left.venue.localeCompare(right.venue) ||
      left.venueMarketId.localeCompare(right.venueMarketId) ||
      left.sourceTimestamp.getTime() - right.sourceTimestamp.getTime()
  );

export const filterWindow = (
  states: readonly HistoricalMarketState[],
  start?: Date,
  end?: Date
): HistoricalMarketState[] =>
  states.filter(
    (state) =>
      (start === undefined || state.timestamp.getTime() >= start.getTime()) &&
      (end === undefined || state.timestamp.getTime() <= end.getTime())
  );

export const validateCommonInput = (
  input: HistoricalSimulationBaselineInput,
  venue?: string
): HistoricalMarketState[] => {
  if (input.marketStates.length === 0) {
    throw new HistoricalSimulationBaselineError("insufficient_historical_state", "At least one historical market state is required.");
  }

  const inputCanonicalEventIds = new Set(input.marketStates.map((state) => state.canonicalEventId));
  if (inputCanonicalEventIds.size !== 1 || !inputCanonicalEventIds.has(input.canonicalEventId)) {
    throw new HistoricalSimulationBaselineError("invalid_baseline_input", "All historical states must belong to exactly one canonical event.");
  }

  const scoped = sortStates(
    filterWindow(
      input.marketStates.filter(
        (state) => state.canonicalEventId === input.canonicalEventId && (venue === undefined || state.venue === venue)
      ),
      input.timelineSliceStart,
      input.timelineSliceEnd
    )
  );

  if (scoped.length === 0) {
    throw new HistoricalSimulationBaselineError("insufficient_historical_state", "No eligible historical states remain after filtering.");
  }

  const canonicalEventIds = new Set(scoped.map((state) => state.canonicalEventId));
  if (canonicalEventIds.size !== 1) {
    throw new HistoricalSimulationBaselineError("invalid_baseline_input", "All historical states must belong to exactly one canonical event.");
  }

  if (venue !== undefined) {
    const venueMarketIds = new Set(scoped.map((state) => state.venueMarketId));
    if (venueMarketIds.size !== 1) {
      throw new HistoricalSimulationBaselineError(
        "ambiguous_venue_scope",
        `${venue} baseline requires exactly one venue market in scope.`
      );
    }
  }

  return scoped;
};

export const computeFees = (
  policy: HistoricalSimulationFeePolicy,
  venue: string,
  notional: InstanceType<typeof Decimal>
): InstanceType<typeof Decimal> => {
  const venuePolicy = policy.venues[venue];
  if (!venuePolicy) {
    throw new HistoricalSimulationBaselineError("invalid_baseline_input", `Missing fee policy for venue ${venue}.`);
  }

  const feeBps = parseDecimal(venuePolicy.feeBps, `feePolicy.venues.${venue}.feeBps`);
  const fixedFee = venuePolicy.fixedFee === undefined ? ZERO : parseDecimal(venuePolicy.fixedFee, `feePolicy.venues.${venue}.fixedFee`);
  return notional.times(feeBps).div(10_000).plus(fixedFee);
};

export const extractPriceCandidate = (
  state: HistoricalMarketState,
  side: HistoricalSimulationOrderSide
): SelectedHistoricalPriceState | null => {
  if (side === "BUY") {
    if (state.bestAsk !== null) {
      return { state, selectedPrice: parseDecimal(state.bestAsk, "bestAsk"), priceSource: "bestAsk" };
    }
    if (state.midpoint !== null) {
      return { state, selectedPrice: parseDecimal(state.midpoint, "midpoint"), priceSource: "midpoint" };
    }
    if (state.lastPrice !== null) {
      return { state, selectedPrice: parseDecimal(state.lastPrice, "lastPrice"), priceSource: "lastPrice" };
    }
    if (state.bestBid !== null) {
      return { state, selectedPrice: parseDecimal(state.bestBid, "bestBid"), priceSource: "bestBid" };
    }
    return null;
  }

  if (state.bestBid !== null) {
    return { state, selectedPrice: parseDecimal(state.bestBid, "bestBid"), priceSource: "bestBid" };
  }
  if (state.midpoint !== null) {
    return { state, selectedPrice: parseDecimal(state.midpoint, "midpoint"), priceSource: "midpoint" };
  }
  if (state.lastPrice !== null) {
    return { state, selectedPrice: parseDecimal(state.lastPrice, "lastPrice"), priceSource: "lastPrice" };
  }
  if (state.bestAsk !== null) {
    return { state, selectedPrice: parseDecimal(state.bestAsk, "bestAsk"), priceSource: "bestAsk" };
  }
  return null;
};

export const selectBestPriceState = (
  states: readonly HistoricalMarketState[],
  side: HistoricalSimulationOrderSide
): SelectedHistoricalPriceState => {
  const candidates = states.map((state) => extractPriceCandidate(state, side)).filter((value): value is SelectedHistoricalPriceState => value !== null);
  if (candidates.length === 0) {
    throw new HistoricalSimulationBaselineError("unsupported_market_shape", "No usable price evidence was found in the historical state.");
  }

  return [...candidates].sort(
    (left, right) =>
      (side === "BUY" ? left.selectedPrice.cmp(right.selectedPrice) : right.selectedPrice.cmp(left.selectedPrice)) ||
      left.state.timestamp.getTime() - right.state.timestamp.getTime() ||
      left.state.venueMarketId.localeCompare(right.state.venueMarketId)
  )[0]!;
};

export const selectReferencePriceState = (
  states: readonly HistoricalMarketState[],
  side: HistoricalSimulationOrderSide
): SelectedHistoricalPriceState => {
  for (const state of states) {
    const candidate = extractPriceCandidate(state, side);
    if (candidate !== null) {
      return candidate;
    }
  }

  throw new HistoricalSimulationBaselineError("unsupported_market_shape", "A deterministic reference price could not be determined.");
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseTopLevelSize = (level: unknown): InstanceType<typeof Decimal> | null => {
  const record = asRecord(level);
  if (record === null) {
    return null;
  }
  const raw = record.size;
  return typeof raw === "string" || typeof raw === "number" ? parseDecimal(raw, "orderbook.size") : null;
};

export const inferPolymarketFillProbability = (
  state: HistoricalMarketState,
  requestedQuantity: InstanceType<typeof Decimal>,
  side: HistoricalSimulationOrderSide
): FillProbabilityResult => {
  const snapshot = asRecord(state.orderbookSnapshot);
  if (snapshot === null) {
    return { fillProbability: null, fillProbabilityReason: "depth_missing" };
  }

  const bids = Array.isArray(snapshot.bids) ? snapshot.bids : [];
  const asks = Array.isArray(snapshot.asks) ? snapshot.asks : [];
  const topSize = side === "BUY" ? parseTopLevelSize(asks[0]) : parseTopLevelSize(bids[0]);

  if (topSize === null) {
    return { fillProbability: null, fillProbabilityReason: "depth_missing" };
  }

  const proxySize = topSize;
  if (proxySize.lte(0)) {
    return { fillProbability: "0", fillProbabilityReason: null };
  }
  if (proxySize.gte(requestedQuantity)) {
    return { fillProbability: "1", fillProbabilityReason: null };
  }

  return {
    fillProbability: Decimal.max(ZERO, Decimal.min(proxySize.div(requestedQuantity), ONE)).toString(),
    fillProbabilityReason: null
  };
};

const tryOwnExecutionRatio = (value: Record<string, unknown>): FillProbabilityResult | null => {
  const numeratorKeys = ["fillProbabilityNumerator", "observedFilledCount"] as const;
  const denominatorKeys = ["fillProbabilityDenominator", "observedOpportunityCount"] as const;

  for (let index = 0; index < numeratorKeys.length; index += 1) {
    const numerator = value[numeratorKeys[index]!];
    const denominator = value[denominatorKeys[index]!];
    if ((typeof numerator === "string" || typeof numerator === "number") && (typeof denominator === "string" || typeof denominator === "number")) {
      const parsedNumerator = parseDecimal(numerator, numeratorKeys[index]!);
      const parsedDenominator = parseDecimal(denominator, denominatorKeys[index]!);
      if (parsedDenominator.lte(0)) {
        return { fillProbability: null, fillProbabilityReason: "invalid_own_execution_ratio" };
      }
      return {
        fillProbability: Decimal.max(ZERO, Decimal.min(parsedNumerator.div(parsedDenominator), ONE)).toString(),
        fillProbabilityReason: null
      };
    }
  }

  return null;
};

export const inferLimitlessFillProbability = (states: readonly HistoricalMarketState[]): FillProbabilityResult => {
  const ownExecutionEntries = states
    .map((state) => state.ownExecutionHistory)
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  if (ownExecutionEntries.length === 0) {
    return { fillProbability: null, fillProbabilityReason: "price_only_history" };
  }

  for (const entry of ownExecutionEntries) {
    const ratio = tryOwnExecutionRatio(entry);
    if (ratio !== null) {
      return ratio;
    }
  }

  return { fillProbability: null, fillProbabilityReason: "insufficient_own_execution_history" };
};

export const inferOpinionFillProbability = (_states: readonly HistoricalMarketState[]): FillProbabilityResult => ({
  fillProbability: null,
  fillProbabilityReason: "price_only_history"
});

const parseEventValue = (value: unknown): InstanceType<typeof Decimal> | null =>
  typeof value === "string" || typeof value === "number" ? parseDecimal(value, "marketEvents.value") : null;

const extractMyriadObservedNotional = (states: readonly HistoricalMarketState[]): InstanceType<typeof Decimal> => {
  let observed = ZERO;

  for (const state of states) {
    const marketEvents = asRecord(state.marketEvents);
    if (marketEvents === null) {
      continue;
    }
    const events = Array.isArray(marketEvents.events) ? marketEvents.events : [];
    for (const entry of events) {
      const record = asRecord(entry);
      if (record === null) {
        continue;
      }
      const action = typeof record.action === "string" ? record.action : null;
      if (action !== "buy" && action !== "sell") {
        continue;
      }
      const parsed = parseEventValue(record.value);
      if (parsed !== null && parsed.gt(observed)) {
        observed = parsed;
      }
    }
  }

  return observed;
};

export const inferMyriadFillProbability = (
  states: readonly HistoricalMarketState[],
  requestedNotional: InstanceType<typeof Decimal>
): FillProbabilityResult => {
  const observed = extractMyriadObservedNotional(states);
  if (observed.lte(0)) {
    return { fillProbability: null, fillProbabilityReason: "price_only_history" };
  }

  const probability = Decimal.min(ONE, observed.div(requestedNotional).times("0.5"));
  return {
    fillProbability: probability.toString(),
    fillProbabilityReason: "event_capped_conservative"
  };
};

export const buildEstimate = (params: {
  venue: string;
  baselineType: HistoricalSimulationBaselineType;
  side: HistoricalSimulationOrderSide;
  states: readonly HistoricalMarketState[];
  selected: SelectedHistoricalPriceState;
  reference: SelectedHistoricalPriceState;
  requestedNotional: InstanceType<typeof Decimal>;
  feePolicy: HistoricalSimulationFeePolicy;
  fillProbability: FillProbabilityResult;
  metadata?: Record<string, unknown>;
}): HistoricalSimulationBaselineEstimate => {
  const requestedQuantity = params.reference.selectedPrice.gt(0)
    ? params.requestedNotional.div(params.reference.selectedPrice)
    : ZERO;
  const tradedNotional = params.selected.selectedPrice.times(requestedQuantity);
  const fees = computeFees(params.feePolicy, params.venue, tradedNotional);
  const effectiveCost =
    params.side === "BUY"
      ? tradedNotional.plus(fees)
      : fees.minus(tradedNotional);
  const slippage =
    params.side === "BUY"
      ? params.selected.selectedPrice.minus(params.reference.selectedPrice).times(requestedQuantity)
      : params.reference.selectedPrice.minus(params.selected.selectedPrice).times(requestedQuantity);
  const timestampStart = params.states[0]!.timestamp;
  const timestampEnd = params.states[params.states.length - 1]!.timestamp;

  return {
    venue: params.venue,
    baselineType: params.baselineType,
    effectiveCost: effectiveCost.toString(),
    slippage: slippage.toString(),
    fees: fees.toString(),
    fillProbability: params.fillProbability.fillProbability,
    fillProbabilityReason: params.fillProbability.fillProbabilityReason,
    timestampStart,
    timestampEnd,
    observedStateCount: params.states.length,
    metadata: {
      feePolicyVersion: params.feePolicy.version,
      side: params.side,
      referencePriceSource: params.reference.priceSource,
      referencePrice: params.reference.selectedPrice.toString(),
      selectedStateTimestamp: params.selected.state.timestamp.toISOString(),
      selectedVenueMarketId: params.selected.state.venueMarketId,
      observationCount: params.states.length,
      requestedNotional: params.requestedNotional.toString(),
      requestedQuantity: requestedQuantity.toString(),
      selectedPrice: params.selected.selectedPrice.toString(),
      ...(params.metadata ?? {})
    }
  };
};
