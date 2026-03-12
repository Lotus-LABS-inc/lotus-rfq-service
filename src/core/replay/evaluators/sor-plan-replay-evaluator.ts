import type { ICostModel } from "../../sor/types.js";
import type { ISplitter } from "../../sor/types.js";
import {
    CanonicalRFQInputSchema,
    type CandidateScore,
    RouteCandidateSchema,
    SelectedQuoteInputSchema,
    type SplitAllocation
} from "../../sor/types.js";
import { asArray, asObject, ReplayEvaluationError } from "./shared.js";

const normalizeBuildResult = (value: Record<string, unknown>): Record<string, unknown> => {
    const kind = value.kind;
    if (kind === "plan_created") {
        return {
            kind,
            crossingFilledSize: value.crossingFilledSize ?? null,
            remainingSize: value.remainingSize ?? null
        };
    }

    if (kind === "internal_filled") {
        return {
            kind,
            filledSize: value.filledSize ?? null
        };
    }

    return value;
};

export const replaySORPlan = async (
    inputSnapshot: Record<string, unknown>,
    costModel: ICostModel,
    splitter: ISplitter
): Promise<Record<string, unknown>> => {
    const rfq = CanonicalRFQInputSchema.parse(inputSnapshot.rfq);
    const selectedQuote = SelectedQuoteInputSchema.parse(inputSnapshot.selectedQuote);
    const policy = typeof inputSnapshot.policy === "string" ? inputSnapshot.policy : "BEST_EFFORT";
    const routeCandidates = asArray(inputSnapshot.routeCandidates, "inputSnapshot.routeCandidates").map((candidate) =>
        RouteCandidateSchema.parse(candidate)
    );
    const resolutionRiskPairPolicies = asArray(
        inputSnapshot.resolutionRiskPairPolicies ?? [],
        "inputSnapshot.resolutionRiskPairPolicies"
    ).map((entry) => asObject(entry, "inputSnapshot.resolutionRiskPairPolicies[]"));

    const scoredCandidates = await costModel.evaluateCandidates(
        rfq,
        routeCandidates,
        selectedQuote,
        policy as "ALL_OR_NONE" | "PARTIAL_ALLOWED" | "BEST_EFFORT"
    );

    const pairPolicies = new Map<string, { mode: "normal" | "penalty" | "isolated_only" | "blocked"; penalty: number }>();
    for (const entry of resolutionRiskPairPolicies) {
        const pairKey = typeof entry.pairKey === "string" ? entry.pairKey : typeof entry.key === "string" ? entry.key : null;
        if (!pairKey) {
            throw new ReplayEvaluationError("invalid_replay_envelope", "SOR replay requires pairKey for resolution risk policy entries.");
        }
        pairPolicies.set(pairKey, {
            mode: (typeof entry.mode === "string" ? entry.mode : "normal") as "normal" | "penalty" | "isolated_only" | "blocked",
            penalty: typeof entry.penalty === "number" ? entry.penalty : 0
        });
    }

    const allocations = await splitter.split(selectedQuote.quantity, scoredCandidates, {
        minChunkSize: 1,
        tickSize: 1,
        perProviderCapacity: {},
        resolutionRisk: { pairPolicies }
    });

    return {
        decisionTrace: {
            scoredCandidates: scoredCandidates as CandidateScore[],
            allocations: allocations as SplitAllocation[]
        },
        buildResult: normalizeBuildResult(asObject(inputSnapshot.buildResult ?? { kind: "plan_created" }, "inputSnapshot.buildResult"))
    };
};
