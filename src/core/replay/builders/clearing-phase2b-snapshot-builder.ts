import type { BuildClearingPhase2BReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface IClearingPhase2BSnapshotBuilder {
    build(input: BuildClearingPhase2BReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class ClearingPhase2BSnapshotBuilder implements IClearingPhase2BSnapshotBuilder {
    public build(input: BuildClearingPhase2BReplayEnvelopeInput): WriteReplayEnvelopeInput {
        if (input.bucketEntityOrder.length !== input.candidateSnapshots.length) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "bucketEntityOrder must match candidate snapshot count.");
        }
        if (input.selectedPlan === null) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "selectedPlan must be captured explicitly for clearing replay.");
        }

        const participantIds = input.selectedPlan.participantLockOrder;
        if (!Array.isArray(participantIds) || participantIds.length === 0) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "selectedPlan.participantLockOrder must be present.");
        }

        const entityId = `${input.bucketId}:${participantIds.join("|")}`;
        return buildReplayEnvelope({
            decisionType: "CLEARING_PHASE2B",
            entityId,
            metadata: input,
            inputSnapshot: {
                bucketId: input.bucketId,
                plannerConfig: input.plannerConfig,
                candidateSnapshots: input.candidateSnapshots
            },
            decisionTrace: {
                bucketEntityOrder: input.bucketEntityOrder,
                overlapGraph: input.overlapGraph,
                enumeratedGroups: input.enumeratedGroups,
                scoreSnapshots: input.scoreSnapshots,
                resolutionEligibilityExclusions: input.resolutionEligibilityExclusions,
                participantLockOrder: input.selectedPlan.participantLockOrder
            },
            outputSnapshot: {
                selectedPlan: input.selectedPlan
            }
        });
    }
}
