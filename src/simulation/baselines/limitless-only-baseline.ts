import {
  buildEstimate,
  inferLimitlessFillProbability,
  resolveRequestedSize,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class LimitlessOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "LIMITLESS");
    const requestedSize = resolveRequestedSize(input.requestedSize);
    const selected = selectBestPriceState(states);
    const reference = selectReferencePriceState(states);

    return buildEstimate({
      venue: "LIMITLESS",
      baselineType: "LIMITLESS_ONLY",
      states,
      selected,
      reference,
      requestedSize,
      feePolicy: input.feePolicy,
      fillProbability: inferLimitlessFillProbability(states)
    });
  }
}
