import type { EconomicExecutionSnapshot } from "../economic-quality-engine.js";
import {
    buildExternalizedEconomicSnapshot,
    pickDeterministicBestCandidate,
    type BaselineExecutionDefaults,
    type BaselineRouteCandidateInput,
    type BaselineSelectedQuoteInput
} from "./shared.js";

export interface NoResolutionRiskBaselineInput {
    selectedQuote: BaselineSelectedQuoteInput;
    routeCandidates: readonly BaselineRouteCandidateInput[];
    rfqGroupingSnapshot?: Record<string, unknown>;
    fallbackCandidateOrdering?: readonly string[];
    realizedExecution?: BaselineExecutionDefaults;
}

export class NoResolutionRiskBaselineBuilder {
    public build(input: NoResolutionRiskBaselineInput): EconomicExecutionSnapshot {
        const candidate = pickDeterministicBestCandidate(
            input.routeCandidates,
            input.selectedQuote,
            input.fallbackCandidateOrdering
                ? {
                    neutralizeResolutionRisk: true,
                    fallbackCandidateOrdering: input.fallbackCandidateOrdering
                }
                : {
                    neutralizeResolutionRisk: true
                }
        );

        const metadata = {
            ...(input.realizedExecution?.metadata ?? {}),
            neutralizedResolutionRisk: true,
            rfqGroupingSnapshotPresent: input.rfqGroupingSnapshot !== undefined
        };

        return buildExternalizedEconomicSnapshot(candidate, input.selectedQuote, {
            ...input.realizedExecution,
            metadata
        });
    }
}
