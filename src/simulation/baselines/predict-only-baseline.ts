import {
  buildEstimate,
  inferPolymarketFillProbability,
  resolveRequestedNotional,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class PredictOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "PREDICT");
    const requestedNotional = resolveRequestedNotional(input.requestedNotional);
    const reference = selectReferencePriceState(states, input.side);
    const requestedQuantity = reference.selectedPrice.gt(0) ? requestedNotional.div(reference.selectedPrice) : requestedNotional;
    const selected = selectBestPriceState(states, input.side);

    return buildEstimate({
      venue: "PREDICT",
      baselineType: "PREDICT_ONLY",
      side: input.side,
      states,
      selected,
      reference,
      requestedNotional,
      feePolicy: input.feePolicy,
      fillProbability: inferPolymarketFillProbability(selected.state, requestedQuantity, input.side)
    });
  }
}
