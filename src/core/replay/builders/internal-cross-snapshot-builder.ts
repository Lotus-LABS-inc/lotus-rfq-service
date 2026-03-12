import type { BuildInternalCrossReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface IInternalCrossSnapshotBuilder {
    build(input: BuildInternalCrossReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class InternalCrossSnapshotBuilder implements IInternalCrossSnapshotBuilder {
    public build(input: BuildInternalCrossReplayEnvelopeInput): WriteReplayEnvelopeInput {
        if (input.makerIterationOrder.length !== input.orderedCandidates.length) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "makerIterationOrder must match ordered candidate count.");
        }

        return buildReplayEnvelope({
            decisionType: "INTERNAL_CROSS",
            entityId: input.incomingOrderId,
            metadata: input,
            inputSnapshot: {
                incomingOrderId: input.incomingOrderId,
                incomingOrder: input.incomingOrder,
                orderedCandidates: input.orderedCandidates
            },
            decisionTrace: {
                selfTradeChecks: input.selfTradeChecks,
                resolutionEligibilityDecisions: input.resolutionEligibilityDecisions,
                makerIterationOrder: input.makerIterationOrder,
                lockOrder: input.lockOrder,
                matchDecisions: input.matchDecisions
            },
            outputSnapshot: {
                result: input.result
            }
        });
    }
}
