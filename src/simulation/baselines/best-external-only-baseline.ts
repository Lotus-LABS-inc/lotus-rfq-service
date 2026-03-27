import type { HistoricalSimulationBaselineEstimate, HistoricalSimulationBaselineInput } from "./shared.js";
import { HistoricalSimulationBaselineError } from "./shared.js";
import { LimitlessOnlyBaselineEvaluator } from "./limitless-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "./myriad-only-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "./opinion-only-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "./polymarket-only-baseline.js";
import { PredictOnlyBaselineEvaluator } from "./predict-only-baseline.js";
import { parseDecimal } from "./shared.js";

const compareEstimates = (
  left: HistoricalSimulationBaselineEstimate,
  right: HistoricalSimulationBaselineEstimate
): number =>
  parseDecimal(left.effectiveCost, "left.effectiveCost").cmp(parseDecimal(right.effectiveCost, "right.effectiveCost")) ||
  parseDecimal(left.fees, "left.fees").cmp(parseDecimal(right.fees, "right.fees")) ||
  parseDecimal(left.slippage, "left.slippage").cmp(parseDecimal(right.slippage, "right.slippage")) ||
  left.venue.localeCompare(right.venue);

export class BestExternalOnlyBaselineEvaluator {
  public constructor(
    private readonly polymarketOnly = new PolymarketOnlyBaselineEvaluator(),
    private readonly limitlessOnly = new LimitlessOnlyBaselineEvaluator(),
    private readonly opinionOnly = new OpinionOnlyBaselineEvaluator(),
    private readonly myriadOnly = new MyriadOnlyBaselineEvaluator(),
    private readonly predictOnly = new PredictOnlyBaselineEvaluator()
  ) {}

  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const pricedVenues = new Set(
      input.marketStates
        .filter(
          (state) =>
            state.bestBid !== null || state.bestAsk !== null || state.midpoint !== null || state.lastPrice !== null
        )
        .map((state) => state.venue)
    );
    const candidates = [
      pricedVenues.has("POLYMARKET") ? this.polymarketOnly.evaluate(input) : null,
      pricedVenues.has("LIMITLESS") ? this.limitlessOnly.evaluate(input) : null,
      pricedVenues.has("OPINION") ? this.opinionOnly.evaluate(input) : null,
      pricedVenues.has("MYRIAD") ? this.myriadOnly.evaluate(input) : null,
      pricedVenues.has("PREDICT") ? this.predictOnly.evaluate(input) : null
    ].filter((candidate): candidate is HistoricalSimulationBaselineEstimate => candidate !== null).sort(compareEstimates);
    if (candidates.length === 0) {
      throw new HistoricalSimulationBaselineError(
        "unsupported_market_shape",
        "No external venue has deterministic historical price evidence in the requested slice."
      );
    }
    const winner = candidates[0]!;
    const losers = candidates.slice(1).map((estimate) => ({
      venue: estimate.venue,
      effectiveCost: estimate.effectiveCost,
      fees: estimate.fees,
      slippage: estimate.slippage
    }));

    return {
      ...winner,
      baselineType: "BEST_EXTERNAL_ONLY",
      metadata: {
        ...winner.metadata,
        loserComparisons: losers
      }
    };
  }
}
