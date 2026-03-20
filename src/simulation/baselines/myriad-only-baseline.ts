import {
  buildEstimate,
  inferMyriadFillProbability,
  resolveRequestedNotional,
  selectBestPriceState,
  selectReferencePriceState,
  validateCommonInput,
  type HistoricalSimulationBaselineEstimate,
  type HistoricalSimulationBaselineInput
} from "./shared.js";

export class MyriadOnlyBaselineEvaluator {
  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const states = validateCommonInput(input, "MYRIAD");
    const requestedNotional = resolveRequestedNotional(input.requestedNotional);
    const selected = selectBestPriceState(states, input.side);
    const reference = selectReferencePriceState(states, input.side);

    return buildEstimate({
      venue: "MYRIAD",
      baselineType: "MYRIAD_ONLY",
      side: input.side,
      states,
      selected,
      reference,
      requestedNotional,
      feePolicy: input.feePolicy,
      fillProbability: inferMyriadFillProbability(states, requestedNotional),
      metadata: {
        executionModel: "amm_conservative"
      }
    });
  }
}
