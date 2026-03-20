import {
  buildEstimate,
  inferOpinionFillProbability,
  resolveRequestedNotional,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class OpinionOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "OPINION");
    const requestedNotional = resolveRequestedNotional(input.requestedNotional);
    const selected = selectBestPriceState(states, input.side);
    const reference = selectReferencePriceState(states, input.side);

    return buildEstimate({
      venue: "OPINION",
      baselineType: "OPINION_ONLY",
      side: input.side,
      states,
      selected,
      reference,
      requestedNotional,
      feePolicy: input.feePolicy,
      fillProbability: inferOpinionFillProbability(states)
    });
  }
}
