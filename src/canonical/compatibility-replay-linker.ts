import type { CompatibilityDecision } from "./compatibility-decision.js";

export interface CompatibilityReplayLink {
    decisionId: string;
    replayEnvelopeId: string | null;
    compatibilityVersionId: string;
}

export const buildCompatibilityReplayLink = (
    decision: CompatibilityDecision
): CompatibilityReplayLink => ({
    decisionId: decision.id,
    replayEnvelopeId: decision.replayReference,
    compatibilityVersionId: decision.compatibilityVersionId
});
