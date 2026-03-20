import Decimal from "decimal.js";

import type {
  HistoricalRoutedExecutionPlan,
  HistoricalRoutingComparison,
  HistoricalSimulationOrderSide
} from "../core/historical-simulation/historical-simulation.types.js";
import type {
  HistoricalLotusFeeAdjustedResult,
  HistoricalLotusPathEvaluatorBundle,
  HistoricalLotusPathSliceContext,
  HistoricalLotusResolutionRiskGatingResult
} from "./historical-simulation-runner.js";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

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

const extractPrice = (
  state: HistoricalLotusPathSliceContext["states"][number],
  side: HistoricalSimulationOrderSide
): { price: InstanceType<typeof Decimal>; source: string } | null => {
  if (side === "BUY") {
    return (
      (state.bestAsk !== null ? { price: parseDecimal(state.bestAsk)!, source: "bestAsk" } : null) ??
      (state.midpoint !== null ? { price: parseDecimal(state.midpoint)!, source: "midpoint" } : null) ??
      (state.lastPrice !== null ? { price: parseDecimal(state.lastPrice)!, source: "lastPrice" } : null) ??
      (state.bestBid !== null ? { price: parseDecimal(state.bestBid)!, source: "bestBid" } : null)
    );
  }

  return (
    (state.bestBid !== null ? { price: parseDecimal(state.bestBid)!, source: "bestBid" } : null) ??
    (state.midpoint !== null ? { price: parseDecimal(state.midpoint)!, source: "midpoint" } : null) ??
    (state.lastPrice !== null ? { price: parseDecimal(state.lastPrice)!, source: "lastPrice" } : null) ??
    (state.bestAsk !== null ? { price: parseDecimal(state.bestAsk)!, source: "bestAsk" } : null)
  );
};

const extractTopLevelSize = (level: unknown): InstanceType<typeof Decimal> | null => {
  if (!isRecord(level)) {
    return null;
  }
  return parseDecimal(level.size);
};

const extractExplicitDepth = (
  state: HistoricalLotusPathSliceContext["states"][number],
  side: HistoricalSimulationOrderSide
): { quantity: InstanceType<typeof Decimal>; source: string } | null => {
  const snapshot = isRecord(state.orderbookSnapshot) ? state.orderbookSnapshot : null;
  if (snapshot === null) {
    return null;
  }

  const levels = side === "BUY"
    ? (Array.isArray(snapshot.asks) ? snapshot.asks : [])
    : (Array.isArray(snapshot.bids) ? snapshot.bids : []);
  const quantity = extractTopLevelSize(levels[0]);
  return quantity !== null ? { quantity, source: side === "BUY" ? "top_ask_size" : "top_bid_size" } : null;
};

interface RouteCandidate {
  venue: string;
  venueMarketId: string;
  price: InstanceType<typeof Decimal>;
  priceSource: string;
  depthQuantity: InstanceType<typeof Decimal> | null;
  depthSource: string;
}

const buildCandidates = (context: HistoricalLotusPathSliceContext): RouteCandidate[] =>
  context.states
    .map((state) => {
      const price = extractPrice(state, context.side);
      if (price === null) {
        return null;
      }
      const depth = extractExplicitDepth(state, context.side);
      return {
        venue: state.venue,
        venueMarketId: state.venueMarketId,
        price: price.price,
        priceSource: price.source,
        depthQuantity: depth?.quantity ?? null,
        depthSource: depth?.source ?? "depth_missing"
      };
    })
    .filter((candidate): candidate is RouteCandidate => candidate !== null)
    .sort((left, right) =>
      (context.side === "BUY" ? left.price.cmp(right.price) : right.price.cmp(left.price)) ||
      left.venue.localeCompare(right.venue) ||
      left.venueMarketId.localeCompare(right.venueMarketId)
    );

const earliestReferencePrice = (context: HistoricalLotusPathSliceContext): InstanceType<typeof Decimal> => {
  const candidates = [...context.states]
    .sort(
      (left, right) =>
        left.timestamp.getTime() - right.timestamp.getTime() ||
        left.venue.localeCompare(right.venue) ||
        left.venueMarketId.localeCompare(right.venueMarketId) ||
        left.sourceTimestamp.getTime() - right.sourceTimestamp.getTime()
    )
    .map((state) => extractPrice(state, context.side)?.price ?? null)
    .filter((value): value is InstanceType<typeof Decimal> => value !== null);

  return candidates[0] ?? ZERO;
};

const computeRequestedQuantity = (
  requestedNotional: InstanceType<typeof Decimal>,
  referencePrice: InstanceType<typeof Decimal>
): InstanceType<typeof Decimal> => referencePrice.gt(0) ? requestedNotional.div(referencePrice) : ZERO;

const inferAllocationFillProbability = (
  candidate: RouteCandidate,
  requestedQuantity: InstanceType<typeof Decimal>
): { fillProbability: string | null; fillProbabilityReason: string | null } => {
  if (candidate.depthQuantity === null) {
    return { fillProbability: null, fillProbabilityReason: "depth_missing" };
  }

  if (candidate.depthQuantity.lte(0)) {
    return { fillProbability: "0", fillProbabilityReason: null };
  }

  return {
    fillProbability: Decimal.max(ZERO, Decimal.min(candidate.depthQuantity.div(requestedQuantity), ONE)).toString(),
    fillProbabilityReason: null
  };
};

const buildPlan = (
  context: HistoricalLotusPathSliceContext,
  planType: HistoricalRoutedExecutionPlan["planType"],
  allocations: HistoricalRoutedExecutionPlan["allocations"],
  requestedQuantity: InstanceType<typeof Decimal>,
  requestedNotional: InstanceType<typeof Decimal>,
  referencePrice: InstanceType<typeof Decimal>
): HistoricalRoutedExecutionPlan => {
  const filledQuantity = allocations.reduce((total, allocation) => total.plus(allocation.quantity), ZERO);
  const filledNotional = allocations.reduce((total, allocation) => total.plus(allocation.filledNotional), ZERO);
  const fillRatio = requestedQuantity.gt(0) ? Decimal.min(ONE, filledQuantity.div(requestedQuantity)) : ZERO;
  const residualQuantity = Decimal.max(ZERO, requestedQuantity.minus(filledQuantity));
  const residualNotional = Decimal.max(ZERO, requestedNotional.minus(filledNotional));
  const fees = ZERO;
  const averageExecutionPrice = filledQuantity.gt(0) ? filledNotional.div(filledQuantity) : null;
  const slippage =
    context.side === "BUY"
      ? filledNotional.minus(referencePrice.times(filledQuantity))
      : referencePrice.times(filledQuantity).minus(filledNotional);
  const effectiveCost =
    context.side === "BUY"
      ? filledNotional.plus(fees)
      : fees.minus(filledNotional);

  const probabilities = allocations
    .map((allocation) => allocation.fillProbability)
    .filter((value): value is string => value !== null)
    .map((value) => new Decimal(value));
  const fillProbability =
    probabilities.length === allocations.length && allocations.length > 0
      ? probabilities.reduce((total, value, index) => total.plus(value.times(new Decimal(allocations[index]!.quantity))), ZERO)
          .div(filledQuantity)
          .toString()
      : null;
  const provableAllocations = allocations.filter((allocation) => allocation.isProvable);
  const provableFilledQuantity = provableAllocations.reduce((total, allocation) => total.plus(allocation.quantity), ZERO);
  const provableFilledNotional = provableAllocations.reduce((total, allocation) => total.plus(allocation.filledNotional), ZERO);
  const provableFillRatio = requestedQuantity.gt(0) ? Decimal.min(ONE, provableFilledQuantity.div(requestedQuantity)) : ZERO;
  const unprovenResidualQuantity = Decimal.max(ZERO, filledQuantity.minus(provableFilledQuantity));
  const unprovenResidualNotional = Decimal.max(ZERO, filledNotional.minus(provableFilledNotional));
  const containsUnknownDepth = allocations.some((allocation) => allocation.isResidualUnknownDepth || !allocation.isProvable);

  return {
    planType,
    side: context.side,
    requestedNotional: requestedNotional.toString(),
    requestedQuantity: requestedQuantity.toString(),
    filledNotional: filledNotional.toString(),
    filledQuantity: filledQuantity.toString(),
    provableFilledNotional: provableFilledNotional.toString(),
    provableFilledQuantity: provableFilledQuantity.toString(),
    provableFillRatio: provableFillRatio.toString(),
    residualNotional: residualNotional.toString(),
    residualQuantity: residualQuantity.toString(),
    unprovenResidualNotional: unprovenResidualNotional.toString(),
    unprovenResidualQuantity: unprovenResidualQuantity.toString(),
    fillRatio: fillRatio.toString(),
    averageExecutionPrice: averageExecutionPrice?.toString() ?? null,
    effectiveCost: effectiveCost.toString(),
    slippage: slippage.toString(),
    fees: fees.toString(),
    fillProbability,
    fillProbabilityReason:
      allocations.length === 0 ? "no_eligible_allocations" :
      fillProbability === null ? "partial_depth_inference" : null,
    containsUnknownDepth,
    allocations,
    metadata: {
      referencePrice: referencePrice.toString(),
      venueCount: allocations.length,
      containsUnknownDepth,
      hasProvableFill: provableFilledQuantity.gt(0),
      comparableNotional: (provableFilledNotional.gt(0) ? provableFilledNotional : filledNotional).toString()
    }
  };
};

const buildSingleWinnerPlan = (
  context: HistoricalLotusPathSliceContext,
  candidates: readonly RouteCandidate[],
  requestedQuantity: InstanceType<typeof Decimal>,
  requestedNotional: InstanceType<typeof Decimal>,
  referencePrice: InstanceType<typeof Decimal>
): HistoricalRoutedExecutionPlan => {
  const winner = candidates[0];
  if (!winner) {
    return buildPlan(context, "SINGLE_WINNER", [], requestedQuantity, requestedNotional, referencePrice);
  }

  const quantity = winner.depthQuantity ? Decimal.min(requestedQuantity, winner.depthQuantity) : requestedQuantity;
  const filledNotional = winner.price.times(quantity);
  const probability = inferAllocationFillProbability(winner, requestedQuantity);

  return buildPlan(
    context,
    "SINGLE_WINNER",
    [{
      venue: winner.venue,
      venueMarketId: winner.venueMarketId,
      price: winner.price.toString(),
      quantity: quantity.toString(),
      requestedNotional: requestedNotional.toString(),
      filledNotional: filledNotional.toString(),
      fillRatio: requestedQuantity.gt(0) ? Decimal.min(ONE, quantity.div(requestedQuantity)).toString() : null,
      priceSource: winner.priceSource,
      depthSource: winner.depthSource,
      fillProbability: probability.fillProbability,
      fillProbabilityReason: probability.fillProbabilityReason,
      isProvable: winner.depthQuantity !== null,
      isResidualUnknownDepth: winner.depthQuantity === null
    }],
    requestedQuantity,
    requestedNotional,
    referencePrice
  );
};

const buildMultiSplitPlan = (
  context: HistoricalLotusPathSliceContext,
  candidates: readonly RouteCandidate[],
  requestedQuantity: InstanceType<typeof Decimal>,
  requestedNotional: InstanceType<typeof Decimal>,
  referencePrice: InstanceType<typeof Decimal>
): HistoricalRoutedExecutionPlan => {
  let remainingQuantity = requestedQuantity;
  const allocations: Array<HistoricalRoutedExecutionPlan["allocations"][number]> = [];

  for (const candidate of candidates) {
    if (remainingQuantity.lte(0)) {
      break;
    }

    if (candidate.depthQuantity === null || candidate.depthQuantity.lte(0)) {
      continue;
    }

    const quantity = Decimal.min(remainingQuantity, candidate.depthQuantity);
    remainingQuantity = Decimal.max(ZERO, remainingQuantity.minus(quantity));
    const filledNotional = candidate.price.times(quantity);
    const probability = inferAllocationFillProbability(candidate, quantity);

    allocations.push({
      venue: candidate.venue,
      venueMarketId: candidate.venueMarketId,
      price: candidate.price.toString(),
      quantity: quantity.toString(),
      requestedNotional: requestedNotional.toString(),
      filledNotional: filledNotional.toString(),
      fillRatio: requestedQuantity.gt(0) ? Decimal.min(ONE, quantity.div(requestedQuantity)).toString() : null,
      priceSource: candidate.priceSource,
      depthSource: candidate.depthSource,
      fillProbability: probability.fillProbability,
      fillProbabilityReason: probability.fillProbabilityReason,
      isProvable: true,
      isResidualUnknownDepth: false
    });
  }

  if (remainingQuantity.gt(0)) {
    const residualCandidate = candidates.find((candidate) => candidate.depthQuantity === null);
    if (residualCandidate) {
      const quantity = remainingQuantity;
      const filledNotional = residualCandidate.price.times(quantity);
      allocations.push({
        venue: residualCandidate.venue,
        venueMarketId: residualCandidate.venueMarketId,
        price: residualCandidate.price.toString(),
        quantity: quantity.toString(),
        requestedNotional: requestedNotional.toString(),
        filledNotional: filledNotional.toString(),
        fillRatio: requestedQuantity.gt(0) ? Decimal.min(ONE, quantity.div(requestedQuantity)).toString() : null,
        priceSource: residualCandidate.priceSource,
        depthSource: "unknown_depth_residual",
        fillProbability: null,
        fillProbabilityReason: "depth_missing",
        isProvable: false,
        isResidualUnknownDepth: true
      });
      remainingQuantity = ZERO;
    }
  }

  return buildPlan(context, "MULTI_SPLIT", allocations, requestedQuantity, requestedNotional, referencePrice);
};

const comparablePlanCost = (plan: HistoricalRoutedExecutionPlan): InstanceType<typeof Decimal> => {
  const provableFilledNotional = new Decimal(plan.provableFilledNotional);
  const provableFilledQuantity = new Decimal(plan.provableFilledQuantity);
  if (provableFilledQuantity.gt(0) && provableFilledNotional.gt(0)) {
    return provableFilledNotional;
  }
  return new Decimal(plan.effectiveCost);
};

const comparePlans = (
  left: HistoricalRoutedExecutionPlan,
  right: HistoricalRoutedExecutionPlan
): { selectedPlan: HistoricalRoutedExecutionPlan; alternatePlan: HistoricalRoutedExecutionPlan; comparisonReason: string; comparisonBasis: HistoricalRoutingComparison["comparisonBasis"] } => {
  const leftFillRatio = new Decimal(left.provableFillRatio);
  const rightFillRatio = new Decimal(right.provableFillRatio);
  if (!leftFillRatio.eq(rightFillRatio)) {
    return leftFillRatio.gt(rightFillRatio)
      ? { selectedPlan: left, alternatePlan: right, comparisonReason: "higher_fill_ratio", comparisonBasis: "provable_fill_ratio" }
      : { selectedPlan: right, alternatePlan: left, comparisonReason: "higher_fill_ratio", comparisonBasis: "provable_fill_ratio" };
  }

  const leftCost = comparablePlanCost(left);
  const rightCost = comparablePlanCost(right);
  if (!leftCost.eq(rightCost)) {
    return leftCost.lt(rightCost)
      ? { selectedPlan: left, alternatePlan: right, comparisonReason: "lower_effective_cost", comparisonBasis: "economic_cost" }
      : { selectedPlan: right, alternatePlan: left, comparisonReason: "lower_effective_cost", comparisonBasis: "economic_cost" };
  }

  const leftAllocations = left.allocations.length;
  const rightAllocations = right.allocations.length;
  if (leftAllocations !== rightAllocations) {
    return leftAllocations < rightAllocations
      ? { selectedPlan: left, alternatePlan: right, comparisonReason: "fewer_allocations", comparisonBasis: "fewer_allocations" }
      : { selectedPlan: right, alternatePlan: left, comparisonReason: "fewer_allocations", comparisonBasis: "fewer_allocations" };
  }

  return left.planType === "SINGLE_WINNER"
    ? { selectedPlan: left, alternatePlan: right, comparisonReason: "stable_plan_order", comparisonBasis: "stable_plan_order" }
    : { selectedPlan: right, alternatePlan: left, comparisonReason: "stable_plan_order", comparisonBasis: "stable_plan_order" };
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

  if (context.canonicalMarketId && snapshot.canonicalMarketId && snapshot.canonicalMarketId !== context.canonicalMarketId) {
    return {
      allowed: false,
      safeEquivalentEligible: false,
      reason: "identity_mismatch",
      metadata: {
        source: "identity_guard",
        contextMarketId: context.canonicalMarketId,
        snapshotMarketId: snapshot.canonicalMarketId
      }
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

const buildRoutingComparison = (context: HistoricalLotusPathSliceContext): HistoricalRoutingComparison => {
  const candidates = buildCandidates(context);
  const referencePrice = earliestReferencePrice(context);
  const requestedNotional = parseDecimal(context.requestedNotional) ?? ZERO;
  const requestedQuantity = computeRequestedQuantity(requestedNotional, referencePrice);
  const singleWinnerPlan = buildSingleWinnerPlan(context, candidates, requestedQuantity, requestedNotional, referencePrice);
  const multiSplitPlan = buildMultiSplitPlan(context, candidates, requestedQuantity, requestedNotional, referencePrice);

  return comparePlans(singleWinnerPlan, multiSplitPlan);
};

export const createDefaultHistoricalLotusEvaluators = (): HistoricalLotusPathEvaluatorBundle => ({
  evaluateRFQGrouping: (context) => ({
    strategy: "historical_rfq_grouping",
    stateCount: context.states.length,
    venueCount: new Set(context.states.map((state) => state.venue)).size,
    side: context.side,
    requestedNotional: context.requestedNotional
  }),
  evaluateSOR: (context) => {
    const candidates = buildCandidates(context);
    const best = candidates[0];
    return {
      selectedVenue: best?.venue ?? "UNKNOWN",
      selectedVenueMarketId: best?.venueMarketId ?? "UNKNOWN",
      selectedPrice: best?.price.toString() ?? "0",
      side: context.side,
      requestedNotional: context.requestedNotional,
      candidateCount: candidates.length
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
    const routingComparison = buildRoutingComparison(context);
    const selectedPlan = routingComparison.selectedPlan;

    return {
      effectiveCost: selectedPlan.effectiveCost,
      slippage: selectedPlan.slippage,
      fees: selectedPlan.fees,
      fillProbability: selectedPlan.fillProbability,
      fillProbabilityReason: selectedPlan.fillProbabilityReason,
      routingComparison,
      metadata: {
        selectedPlanType: selectedPlan.planType,
        comparisonReason: routingComparison.comparisonReason,
        comparisonBasis: routingComparison.comparisonBasis,
        selectedVenue: selectedPlan.allocations[0]?.venue ?? null,
        selectedVenueMarketId: selectedPlan.allocations[0]?.venueMarketId ?? null,
        requestedNotional: context.requestedNotional,
        side: context.side,
        containsUnknownDepth: selectedPlan.containsUnknownDepth
      }
    };
  }
});
