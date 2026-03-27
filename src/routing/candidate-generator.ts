import type {
    CanonicalRFQInput,
    IRouteScout,
    RouteCandidate,
    SORAcceptancePolicy,
    SelectedQuoteInput
} from "../core/sor/types.js";

export class CandidateGenerator {
    public constructor(private readonly routeScout: IRouteScout) {}

    public async generate(
        rfq: CanonicalRFQInput,
        selectedQuote: SelectedQuoteInput,
        policy: SORAcceptancePolicy,
        options?: { forceRefresh?: boolean }
    ): Promise<readonly RouteCandidate[]> {
        return this.routeScout.discoverCandidates(rfq, selectedQuote, policy, options);
    }
}
