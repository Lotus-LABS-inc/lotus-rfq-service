import type { EconomicExecutionSnapshot } from "../economic-quality-engine.js";
import {
    buildExternalizedEconomicSnapshot,
    pickDeterministicBestCandidate,
    type BaselineExecutionDefaults,
    type BaselineRouteCandidateInput,
    type BaselineSelectedQuoteInput
} from "./shared.js";

export interface ExternalOnlyBaselineInput {
    selectedQuote: BaselineSelectedQuoteInput;
    routeCandidates: readonly BaselineRouteCandidateInput[];
    realizedExecution?: BaselineExecutionDefaults;
}

export class ExternalOnlyBaselineBuilder {
    public build(input: ExternalOnlyBaselineInput): EconomicExecutionSnapshot {
        const candidate = pickDeterministicBestCandidate(input.routeCandidates, input.selectedQuote);
        return buildExternalizedEconomicSnapshot(candidate, input.selectedQuote, input.realizedExecution);
    }
}
