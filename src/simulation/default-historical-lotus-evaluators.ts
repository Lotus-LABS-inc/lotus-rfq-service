import Decimal from "decimal.js";

import type {
  HistoricalLotusFeeAdjustedResult,
  HistoricalLotusPathEvaluatorBundle,
  HistoricalLotusPathSliceContext,
  HistoricalLotusResolutionRiskGatingResult
} from "./historical-simulation-runner.js";

const ZERO = new Decimal(0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDecimal = (value: unknown): InstanceType<typeof Decimal> | null => {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
};

const chooseBestPrice = (context: HistoricalLotusPathSliceContext): {
  venue: string;
  venueMarketId: string;
  price: InstanceType<typeof Decimal>;
} => {
  const candidates = context.states
    .map((state) => ({
      venue: state.venue,
      venueMarketId: state.venueMarketId,
      price:
        parseDecimal(state.bestAsk) ??
        parseDecimal(state.midpoint) ??
        parseDecimal(state.lastPrice)
    }))
    .filter((candidate): candidate is { venue: string; venueMarketId: string; price: InstanceType<typeof Decimal> } => candidate.price !== null)
    .sort(
      (left, right) =>
        left.price.comparedTo(right.price) ||
        left.venue.localeCompare(right.venue) ||
        left.venueMarketId.localeCompare(right.venueMarketId)
    );

  if (candidates.length === 0) {
    return { venue: "UNKNOWN", venueMarketId: "UNKNOWN", price: ZERO };
  }

  return candidates[0]!;
};

const earliestReferencePrice = (context: HistoricalLotusPathSliceContext): InstanceType<typeof Decimal> => {
  const candidates = [...context.states]
    .sort(
      (left, right) =>
        left.timestamp.getTime() - right.timestamp.getTime() ||
        left.venue.localeCompare(right.venue) ||
        left.venueMarketId.localeCompare(right.venueMarketId) ||
        left.sourceTimestamp.getTime() - right.sourceTimestamp.getTime()
    )
    .map((state) => parseDecimal(state.midpoint) ?? parseDecimal(state.lastPrice) ?? parseDecimal(state.bestAsk))
    .filter((value): value is InstanceType<typeof Decimal> => value !== null);

  return candidates[0] ?? ZERO;
};

const evaluateResolutionRiskGating = (
  context: HistoricalLotusPathSliceContext
): HistoricalLotusResolutionRiskGatingResult => {
  const snapshot = context.providedSnapshots?.resolutionRiskSnapshot;
  const hasMultipleVenues = new Set(context.states.map((state) => state.venue)).size > 1;

  if (!hasMultipleVenues) {
    return {
      allowed: true,
      safeEquivalentEligible: true,
      reason: null,
      metadata: { source: "single_venue" }
    };
  }

  if (!isRecord(snapshot)) {
    return {
      allowed: false,
      safeEquivalentEligible: false,
      reason: "resolution_risk_snapshot_missing",
      metadata: { source: "missing_snapshot" }
    };
  }

  const safeEquivalentEligible = snapshot.safeEquivalentEligible === true;
  const freshness = isRecord(snapshot.freshness) ? snapshot.freshness : null;
  const fresh = freshness?.isComplete === true && freshness?.isStale === false;

  if (!fresh) {
    return {
      allowed: false,
      safeEquivalentEligible: false,
      reason: "resolution_risk_snapshot_stale",
      metadata: { source: "snapshot", freshness }
    };
  }

  if (!safeEquivalentEligible) {
    return {
      allowed: false,
      safeEquivalentEligible: false,
      reason: "not_safe_equivalent",
      metadata: { source: "snapshot" }
    };
  }

  return {
    allowed: true,
    safeEquivalentEligible: true,
    reason: null,
    metadata: { source: "snapshot" }
  };
};

export const createDefaultHistoricalLotusEvaluators = (): HistoricalLotusPathEvaluatorBundle => ({
  evaluateRFQGrouping: (context) => ({
    strategy: "historical_rfq_grouping",
    stateCount: context.states.length,
    venueCount: new Set(context.states.map((state) => state.venue)).size
  }),
  evaluateSOR: (context) => {
    const best = chooseBestPrice(context);
    return {
      selectedVenue: best.venue,
      selectedVenueMarketId: best.venueMarketId,
      selectedPrice: best.price.toString()
    };
  },
  evaluateInternalCrossEligibility: (context) => ({
    eligible: false,
    reason: "historical_simulation_external_only",
    stateCount: context.states.length
  }),
  evaluatePhase2ANettingEligibility: (context) => ({
    eligible: false,
    reason: "historical_simulation_external_only",
    stateCount: context.states.length
  }),
  evaluateResolutionRiskGating,
  evaluateFeeAdjustedLotusResult: (context): HistoricalLotusFeeAdjustedResult => {
    const best = chooseBestPrice(context);
    const reference = earliestReferencePrice(context);
    const slippage = best.price.minus(reference);

    return {
      effectiveCost: best.price.toString(),
      slippage: slippage.toString(),
      fees: "0",
      fillProbability: null,
      fillProbabilityReason: "historical_lotus_path_price_only",
      metadata: {
        selectedVenue: best.venue,
        selectedVenueMarketId: best.venueMarketId,
        referencePrice: reference.toString()
      }
    };
  }
});
