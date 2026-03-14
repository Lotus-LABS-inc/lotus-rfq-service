import {
  buildEstimate,
  inferPolymarketFillProbability,
  resolveRequestedSize,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class PolymarketOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "POLYMARKET");
    const requestedSize = resolveRequestedSize(input.requestedSize);
    const selected = selectBestPriceState(states);
    const reference = selectReferencePriceState(states);

    return buildEstimate({
      venue: "POLYMARKET",
      baselineType: "POLYMARKET_ONLY",
      states,
      selected,
      reference,
      requestedSize,
      feePolicy: input.feePolicy,
      fillProbability: inferPolymarketFillProbability(selected.state, requestedSize)
    });
  }
}
