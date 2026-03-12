import type { BuildResolutionRiskReplayEnvelopeInput, WriteReplayEnvelopeInput } from "../replay.types.js";
import { buildReplayEnvelope, ReplaySnapshotBuilderError } from "./shared.js";

export interface IResolutionRiskSnapshotBuilder {
    build(input: BuildResolutionRiskReplayEnvelopeInput): WriteReplayEnvelopeInput;
}

export class ResolutionRiskSnapshotBuilder implements IResolutionRiskSnapshotBuilder {
    public build(input: BuildResolutionRiskReplayEnvelopeInput): WriteReplayEnvelopeInput {
        const profileAId = this.readRequiredString(input.profileA, "id", "profileA");
        const profileBId = this.readRequiredString(input.profileB, "id", "profileB");
        const marketAProfileId = this.readRequiredString(input.scoredAssessment, "marketAProfileId", "scoredAssessment");
        const marketBProfileId = this.readRequiredString(input.scoredAssessment, "marketBProfileId", "scoredAssessment");

        if (profileAId !== marketAProfileId) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "profileA must match scoredAssessment.marketAProfileId.");
        }
        if (profileBId !== marketBProfileId) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "profileB must match scoredAssessment.marketBProfileId.");
        }
        if (profileAId.localeCompare(profileBId) > 0) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "Resolution risk replay snapshots require lower-ID-first profile ordering.");
        }

        const entityId = `${input.canonicalEventId}:${profileAId}:${profileBId}`;
        return buildReplayEnvelope({
            decisionType: "RESOLUTION_RISK_ASSESSMENT",
            entityId,
            metadata: input,
            inputSnapshot: {
                canonicalEventId: input.canonicalEventId,
                orderedProfileIds: [profileAId, profileBId],
                profiles: [input.profileA, input.profileB],
                scoringVersion: input.scoredAssessment.version,
                scoringWeights: input.scoringWeights
            },
            decisionTrace: {
                orderedPair: {
                    marketAProfileId,
                    marketBProfileId
                },
                factorComparison: input.factorComparison,
                confidenceInputs: input.confidenceInputs,
                equivalenceThresholds: input.equivalenceThresholds
            },
            outputSnapshot: {
                assessment: input.scoredAssessment
            }
        });
    }

    private readRequiredString(source: Record<string, unknown>, key: string, fieldName: string): string {
        const value = source[key];
        if (typeof value !== "string" || value.length === 0) {
            throw new ReplaySnapshotBuilderError("invalid_snapshot_input", `${fieldName}.${key} must be a non-empty string.`);
        }
        return value;
    }
}
