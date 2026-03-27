import Decimal from "decimal.js";

import type { PredictOrderbookLevel, PredictSizeEstimate, PredictSimulationSurface } from "../../integrations/predict/predict-types.js";

const sumDepth = (levels: readonly PredictOrderbookLevel[]): InstanceType<typeof Decimal> =>
  levels.reduce((total, level) => total.plus(level.size), new Decimal(0));

const weightedCost = (
  levels: readonly PredictOrderbookLevel[],
  requestedSize: InstanceType<typeof Decimal>
): InstanceType<typeof Decimal> | null => {
  if (levels.length === 0 || requestedSize.lte(0)) {
    return null;
  }
  let remaining = requestedSize;
  let cost = new Decimal(0);
  for (const level of levels) {
    if (remaining.lte(0)) {
      break;
    }
    const size = new Decimal(level.size);
    const take = Decimal.min(size, remaining);
    cost = cost.plus(take.times(level.price));
    remaining = remaining.minus(take);
  }
  return remaining.gt(0) ? null : cost;
};

const classifyBucket = (
  requestedSize: InstanceType<typeof Decimal>,
  totalDepth: InstanceType<typeof Decimal>
): PredictSizeEstimate["sizeBucket"] => {
  if (totalDepth.lte(0)) {
    return "oversized";
  }
  const ratio = requestedSize.div(totalDepth);
  if (ratio.lte(0.1)) {
    return "small";
  }
  if (ratio.lte(0.35)) {
    return "medium";
  }
  if (ratio.lte(1)) {
    return "large";
  }
  return "oversized";
};

export class PredictSizeEstimator {
  public estimate(input: {
    surface: PredictSimulationSurface;
    requestedSize: string;
    side: "BUY" | "SELL";
  }): PredictSizeEstimate {
    const snapshot =
      input.surface.recordedOrderbooks[input.surface.recordedOrderbooks.length - 1] ??
      input.surface.currentOrderbook;
    if (!snapshot) {
      return {
        sizeBucket: "oversized",
        estimatedEffectiveCost: null,
        estimatedSlippage: null,
        fillabilityConfidence: null,
        precision: input.surface.precision,
        provenance: input.surface.provenance,
        rationale: "No native or fallback depth snapshot is available.",
        metadata: {}
      };
    }

    const requestedSize = new Decimal(input.requestedSize);
    const levels = input.side === "BUY" ? snapshot.asks : snapshot.bids;
    const totalDepth = sumDepth(levels);
    const sizeBucket = classifyBucket(requestedSize, totalDepth);
    const effectiveCost = weightedCost(levels, requestedSize);
    const bestPrice = levels[0] ? new Decimal(levels[0].price) : null;
    const slippage = effectiveCost && bestPrice ? effectiveCost.minus(bestPrice.times(requestedSize)) : null;

    return {
      sizeBucket,
      estimatedEffectiveCost: effectiveCost?.toString() ?? null,
      estimatedSlippage: slippage?.toString() ?? null,
      fillabilityConfidence:
        sizeBucket === "small" ? "0.9" :
        sizeBucket === "medium" ? "0.7" :
        sizeBucket === "large" ? "0.4" :
        "0.1",
      precision: input.surface.precision,
      provenance: input.surface.provenance,
      rationale:
        input.surface.precision === "RECORDED_HISTORICAL"
          ? "Estimate derived from recorded or replayable orderbook depth."
          : input.surface.precision === "REALIZED"
            ? "Estimate anchored to realized historical matches with conservative size degradation."
            : input.surface.precision === "ESTIMATED_CONSERVATIVE"
              ? "Estimate derived from current book or coarse fallback depth with conservative confidence."
              : "Insufficient depth for a reliable estimate.",
      metadata: {
        bestPrice: bestPrice?.toString() ?? null,
        totalDepth: totalDepth.toString()
      }
    };
  }
}
