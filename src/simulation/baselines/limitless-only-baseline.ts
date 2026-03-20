import {
  buildEstimate,
  inferLimitlessFillProbability,
  resolveRequestedNotional,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class LimitlessOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "LIMITLESS");
    const requestedNotional = resolveRequestedNotional(input.requestedNotional);
    const selected = selectBestPriceState(states, input.side);
    const reference = selectReferencePriceState(states, input.side);

    return buildEstimate({
      venue: "LIMITLESS",
      baselineType: "LIMITLESS_ONLY",
      side: input.side,
      states,
      selected,
      reference,
      requestedNotional,
      feePolicy: input.feePolicy,
      fillProbability: inferLimitlessFillProbability(states)
    });
  }
}
