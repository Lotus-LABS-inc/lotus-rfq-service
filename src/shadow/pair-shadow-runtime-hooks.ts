import type { Logger } from "pino";

import type { CanonicalRFQInput, CandidateScore, RouteCandidate, SelectedQuoteInput, SplitAllocation } from "../core/sor/types.js";
import type { PairShadowObservation } from "./pair-shadow-observation-types.js";
import { PairShadowRuntimeWriter, type PairShadowReplayHarnessInput, type PairShadowTopUpInput } from "./pair-shadow-runtime-writer.js";

export interface PairShadowRuntimeSorHookInput {
  rfq: CanonicalRFQInput;
  selectedQuote: SelectedQuoteInput;
  routeCandidates: readonly RouteCandidate[];
  scoredCandidates: readonly CandidateScore[];
  allocations: readonly SplitAllocation[];
  replayEnvelopeId?: string | null;
}

export interface PairShadowRuntimeHooksDeps {
  writer: PairShadowRuntimeWriter;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class PairShadowRuntimeHooks {
  private readonly writer: PairShadowRuntimeWriter;
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

  public constructor(deps: PairShadowRuntimeHooksDeps) {
    this.writer = deps.writer;
    this.logger = deps.logger;
  }

  public async recordSorEvaluation(input: PairShadowRuntimeSorHookInput): Promise<PairShadowObservation | null> {
    try {
      return await this.writer.recordSorRuntimeObservation(input);
    } catch (error) {
      this.logger?.warn?.({ err: error, canonicalMarketId: input.rfq.canonicalMarketId }, "Pair shadow runtime hook failed.");
      return null;
    }
  }

  public async recordTopUp(input: PairShadowTopUpInput): Promise<PairShadowObservation> {
    return this.writer.recordTopUpObservation(input);
  }

  public async recordReplayHarnessObservation(input: PairShadowReplayHarnessInput): Promise<PairShadowObservation> {
    return this.writer.recordReplayHarnessObservation(input);
  }
}
