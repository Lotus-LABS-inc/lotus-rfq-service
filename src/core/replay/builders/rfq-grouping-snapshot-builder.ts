import type { BuildRFQGroupingReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface IRFQGroupingSnapshotBuilder {
    build(input: BuildRFQGroupingReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class RFQGroupingSnapshotBuilder implements IRFQGroupingSnapshotBuilder {
    public build(input: BuildRFQGroupingReplayEnvelopeInput): WriteReplayEnvelopeInput {
        const orderedProfileIds = input.orderedCandidateProfiles.map((profile) => {
            const id = profile.id;
            if (typeof id !== "string" || id.length === 0) {
                throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "Every ordered candidate profile must include a non-empty id.");
            }
            return id;
        });

        const sortedProfileIds = [...orderedProfileIds].sort((left, right) => left.localeCompare(right));
        if (orderedProfileIds.join("|") !== sortedProfileIds.join("|")) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "orderedCandidateProfiles must be pre-sorted by profile id.");
        }

        return buildReplayEnvelope({
            decisionType: "RFQ_GROUPING",
            entityId: input.rfqId,
            metadata: input,
            inputSnapshot: {
                rfqId: input.rfqId,
                canonicalEventId: input.canonicalEventId,
                orderedCandidateProfiles: input.orderedCandidateProfiles,
                orderedAssessments: input.orderedAssessments
            },
            decisionTrace: {
                pairGenerationOrder: input.pairGenerationOrder,
                pairMatrix: input.grouping.pairMatrix,
                reasonsByProfile: input.grouping.reasonsByProfile,
                laneDerivationInputs: {
                    safePools: input.grouping.safePools,
                    cautionLanes: input.grouping.cautionLanes,
                    blockedProfiles: input.grouping.blockedProfiles
                }
            },
            outputSnapshot: {
                grouping: input.grouping
            }
        });
    }
}
