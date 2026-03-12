import type { EconomicExecutionSnapshot } from "../economic-quality-engine.js";
import {
    buildExternalizedEconomicSnapshot,
    pickDeterministicBestCandidate,
    type BaselineExecutionDefaults,
    type BaselineRouteCandidateInput,
    type BaselineSelectedQuoteInput
} from "./shared.js";

export interface NoInternalizationBaselineInput {
    selectedQuote: BaselineSelectedQuoteInput;
    routeCandidates: readonly BaselineRouteCandidateInput[];
    internalCrossSnapshot?: Record<string, unknown>;
    phase2ANettingSnapshot?: Record<string, unknown>;
    phase2BClearingSnapshot?: Record<string, unknown>;
    realizedExecution?: BaselineExecutionDefaults;
}

export class NoInternalizationBaselineBuilder {
    public build(input: NoInternalizationBaselineInput): EconomicExecutionSnapshot {
        const candidate = pickDeterministicBestCandidate(input.routeCandidates, input.selectedQuote);

        const metadata = {
            ...(input.realizedExecution?.metadata ?? {}),
            strippedInternalization: {
                internalCrossProvided: input.internalCrossSnapshot !== undefined,
                phase2ANettingProvided: input.phase2ANettingSnapshot !== undefined,
                phase2BClearingProvided: input.phase2BClearingSnapshot !== undefined
            }
        };

        return buildExternalizedEconomicSnapshot(candidate, input.selectedQuote, {
            ...input.realizedExecution,
            metadata
        });
    }
}
