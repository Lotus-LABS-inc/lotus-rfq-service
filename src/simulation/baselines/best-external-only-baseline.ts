import type { HistoricalSimulationBaselineEstimate, HistoricalSimulationBaselineInput } from "./shared.js";
import { LimitlessOnlyBaselineEvaluator } from "./limitless-only-baseline.js";
import { PolymarketOnlyBaselineEvaluator } from "./polymarket-only-baseline.js";
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
    private readonly limitlessOnly = new LimitlessOnlyBaselineEvaluator()
  ) {}

  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const candidates = [this.polymarketOnly.evaluate(input), this.limitlessOnly.evaluate(input)].sort(compareEstimates);
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
