import type { ICandidateGroupEnumerator } from "../../combo-engine/candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "../../combo-engine/clearing-compression-scorer.js";
import type { IOverlapGraphBuilder } from "../../combo-engine/overlap-graph-builder.js";
import type { CandidateGroup, CandidateGroupResidual, ClearingRoundPlan, ScorableResidualVector } from "../../combo-engine/types.js";
import { asArray, asObject, asString } from "./shared.js";

export const replayClearingPhase2B = (
    inputSnapshot: Record<string, unknown>,
    overlapGraphBuilder: IOverlapGraphBuilder,
    candidateGroupEnumerator: ICandidateGroupEnumerator,
    clearingCompressionScorer: IClearingCompressionScorer
): Record<string, unknown> => {
    const bucketId = asString(inputSnapshot.bucketId, "inputSnapshot.bucketId");
    const plannerConfig = asObject(inputSnapshot.plannerConfig, "inputSnapshot.plannerConfig");
    const candidateSnapshots = asArray(inputSnapshot.candidateSnapshots, "inputSnapshot.candidateSnapshots").map((snapshot) => {
        const candidate = asObject(snapshot, "inputSnapshot.candidateSnapshots[]");
        return {
            ...candidate,
            createdAt: candidate.createdAt ?? candidate.registeredAt
        };
    }) as unknown as ScorableResidualVector[];

    const graph = overlapGraphBuilder.build(candidateSnapshots);
    const groups = candidateGroupEnumerator.enumerate(graph, {
        maxParticipants: typeof plannerConfig.maxParticipants === "number" ? plannerConfig.maxParticipants : 4,
        maxUniqueLegs: typeof plannerConfig.maxUniqueLegs === "number" ? plannerConfig.maxUniqueLegs : 6,
        stpMode: (typeof plannerConfig.stpMode === "string" ? plannerConfig.stpMode : "CANCEL_NEWEST") as "CANCEL_NEWEST" | "CANCEL_OLDEST" | "CANCEL_BOTH" | "NONE"
    });

    const scored = groups.map((group) => ({
        group,
        score: clearingCompressionScorer.score(
            group,
            candidateSnapshots.filter((vector) => group.participantIds.includes(vector.entityId))
        )
    }));

    scored.sort((left, right) => {
        const finalScoreDiff = Number(right.score.finalScore) - Number(left.score.finalScore);
        if (finalScoreDiff !== 0) {
            return finalScoreDiff > 0 ? 1 : -1;
        }
        const residualDiff = Number(left.score.postNetAbsResidual) - Number(right.score.postNetAbsResidual);
        if (residualDiff !== 0) {
            return residualDiff;
        }
        return left.group.participantIds.join("|").localeCompare(right.group.participantIds.join("|"));
    });

    const selected = scored[0];
    const selectedPlan: ClearingRoundPlan | null = selected
        ? {
            compatibilityBucket: bucketId,
            selectedGroup: selected.group,
            score: selected.score,
            residuals: selected.group.residualAfterNetting as readonly CandidateGroupResidual[],
            participantLockOrder: [...selected.group.participantIds].sort((left, right) => left.localeCompare(right))
        }
        : null;

    return {
        selectedPlan,
        decisionTrace: {
            overlapGraph: graph,
            enumeratedGroups: groups as readonly CandidateGroup[],
            scoreSnapshots: scored.map((entry) => ({ participantIds: entry.group.participantIds, score: entry.score }))
        }
    };
};
