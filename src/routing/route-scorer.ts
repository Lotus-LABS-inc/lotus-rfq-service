import type {
    CanonicalRFQInput,
    CandidateScore,
    ICostModel,
    RouteCandidate,
    SORAcceptancePolicy,
    SelectedQuoteInput
} from "../core/sor/types.js";

export class RouteScorer {
    public constructor(private readonly costModel: ICostModel) {}

    public async score(
        rfq: CanonicalRFQInput,
        candidates: readonly RouteCandidate[],
        selectedQuote: SelectedQuoteInput,
        policy: SORAcceptancePolicy
    ): Promise<readonly CandidateScore[]> {
        return this.costModel.evaluateCandidates(rfq, candidates, selectedQuote, policy);
    }
}
