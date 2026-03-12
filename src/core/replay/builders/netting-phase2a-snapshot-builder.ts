import type { BuildNettingPhase2AReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface INettingPhase2ASnapshotBuilder {
    build(input: BuildNettingPhase2AReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class NettingPhase2ASnapshotBuilder implements INettingPhase2ASnapshotBuilder {
    public build(input: BuildNettingPhase2AReplayEnvelopeInput): WriteReplayEnvelopeInput {
        if (input.candidateOrder.length !== input.candidateCombos.length) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "candidateOrder must match candidate combo count.");
        }
        if (input.lockResourceIds.length === 0) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "lockResourceIds must explicitly capture sorted lock ordering inputs.");
        }

        return buildReplayEnvelope({
            decisionType: "NETTING_PHASE2A",
            entityId: input.incomingComboId,
            metadata: input,
            inputSnapshot: {
                incomingComboId: input.incomingComboId,
                incomingCombo: input.incomingCombo,
                candidateCombos: input.candidateCombos,
                compatibilityInputs: input.compatibilityInputs
            },
            decisionTrace: {
                candidateOrder: input.candidateOrder,
                matchedLegPairOrder: input.matchedLegPairOrder,
                resolutionEligibilityDecisions: input.resolutionEligibilityDecisions,
                lockResourceIds: input.lockResourceIds,
                attemptSnapshots: input.attemptSnapshots
            },
            outputSnapshot: {
                result: input.result
            }
        });
    }
}
