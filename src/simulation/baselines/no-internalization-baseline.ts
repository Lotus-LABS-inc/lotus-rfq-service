import type { HistoricalSimulationBaselineEstimate, HistoricalSimulationBaselineInput } from "./shared.js";
import { BestExternalOnlyBaselineEvaluator } from "./best-external-only-baseline.js";

export class NoInternalizationBaselineEvaluator {
  public constructor(private readonly bestExternalOnly = new BestExternalOnlyBaselineEvaluator()) {}

  public evaluate(input: HistoricalSimulationBaselineInput): HistoricalSimulationBaselineEstimate {
    const estimate = this.bestExternalOnly.evaluate(input);
    return {
      ...estimate,
      baselineType: "NO_INTERNALIZATION",
      metadata: {
        ...estimate.metadata,
        internalizationStripped: true,
        sourceBaseline: "BEST_EXTERNAL_ONLY"
      }
    };
  }
}
