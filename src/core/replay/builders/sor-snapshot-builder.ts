import type { BuildSORReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface ISORSnapshotBuilder {
    build(input: BuildSORReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class SORSnapshotBuilder implements ISORSnapshotBuilder {
    public build(input: BuildSORReplayEnvelopeInput): WriteReplayEnvelopeInput {
        if (input.candidateOrdering.length !== input.routeCandidates.length) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "candidateOrdering must cover every route candidate.");
        }

        const candidateIds = input.routeCandidates.map((candidate, index) => {
            const id = candidate.id;
            if (typeof id !== "string" || id.length === 0) {
                throw new ReplaySnapshotBuilderError("invalid_snapshot_input", `routeCandidates[${index}].id must be a non-empty string.`);
            }
            return id;
        });
        const orderedCandidateIds = [...candidateIds].sort((left, right) => left.localeCompare(right));
        const normalizedOrdering = [...input.candidateOrdering].sort((left, right) => left.localeCompare(right));
        if (orderedCandidateIds.join("|") !== normalizedOrdering.join("|")) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "candidateOrdering must reference exactly the discovered route candidate ids.");
        }

        return buildReplayEnvelope({
            decisionType: input.buildResult.kind === "plan_created" ? "SOR_PLAN" : "SOR_PLAN",
            entityId: input.rfqId,
            metadata: input,
            inputSnapshot: {
                rfqId: input.rfqId,
                rfq: input.rfq,
                selectedQuote: input.selectedQuote,
                policy: input.policy,
                routeCandidates: input.routeCandidates,
                resolutionRiskPairPolicies: input.resolutionRiskPairPolicies,
                buildResult: input.buildResult
            },
            decisionTrace: {
                candidateOrdering: input.candidateOrdering,
                scoredCandidates: input.scoredCandidates,
                splitEligibilityDecisions: input.splitEligibilityDecisions,
                allocations: input.allocations
            },
            outputSnapshot: {
                buildResult: input.buildResult
            }
        });
    }
}
