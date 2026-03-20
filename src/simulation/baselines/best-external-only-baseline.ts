import type { HistoricalSimulationBaselineEstimate, HistoricalSimulationBaselineInput } from "./shared.js";
import { LimitlessOnlyBaselineEvaluator } from "./limitless-only-baseline.js";
import { MyriadOnlyBaselineEvaluator } from "./myriad-only-baseline.js";
import { OpinionOnlyBaselineEvaluator } from "./opinion-only-baseline.js";
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
    private readonly limitlessOnly = new LimitlessOnlyBaselineEvaluator(),
    private readonly opinionOnly = new OpinionOnlyBaselineEvaluator(),
    private readonly myriadOnly = new MyriadOnlyBaselineEvaluator()
  ) {}

  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const venues = new Set(input.marketStates.map((state) => state.venue));
    const candidates = [
      venues.has("POLYMARKET") ? this.polymarketOnly.evaluate(input) : null,
      venues.has("LIMITLESS") ? this.limitlessOnly.evaluate(input) : null,
      venues.has("OPINION") ? this.opinionOnly.evaluate(input) : null,
      venues.has("MYRIAD") ? this.myriadOnly.evaluate(input) : null
    ].filter((candidate): candidate is HistoricalSimulationBaselineEstimate => candidate !== null).sort(compareEstimates);
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
