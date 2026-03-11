import Decimal from "decimal.js";

import type { IPhase2BCandidateRegistry } from "./phase2b-candidate-registry.js";
import type { IOverlapGraphBuilder } from "./overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "./candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "./clearing-compression-scorer.js";
import type {
  ClearingCompressionScore,
  ClearingRoundPlan,
  ClearingRoundPlannerConfig,
  ScorableResidualVector
} from "./types.js";

const DEFAULT_CONFIG: ClearingRoundPlannerConfig = {
  bucketWindowLimit: 100,
  maxParticipants: 4,
  maxUniqueLegs: 6,
  stpMode: "CANCEL_NEWEST"
};

export interface IClearingRoundPlanner {
  plan(
    bucketId: string,
    config?: Partial<ClearingRoundPlannerConfig>
  ): Promise<ClearingRoundPlan | null>;
}

export class ClearingRoundPlanner implements IClearingRoundPlanner {
  public constructor(
    private readonly candidateRegistry: IPhase2BCandidateRegistry,
    private readonly overlapGraphBuilder: IOverlapGraphBuilder,
    private readonly candidateGroupEnumerator: ICandidateGroupEnumerator,
    private readonly clearingCompressionScorer: IClearingCompressionScorer
  ) {}

  public async plan(
    bucketId: string,
    config: Partial<ClearingRoundPlannerConfig> = {}
  ): Promise<ClearingRoundPlan | null> {
    if (bucketId.trim().length === 0) {
      throw new Error("bucketId is required.");
    }

    const resolvedConfig: ClearingRoundPlannerConfig = {
      ...DEFAULT_CONFIG,
      ...config
    };

    const page = await this.candidateRegistry.listBucketEntities(
      bucketId,
      resolvedConfig.bucketWindowLimit,
      resolvedConfig.bucketCursor
    );

    if (page.entityIds.length === 0) {
      return null;
    }

    const snapshots = await Promise.all(
      page.entityIds.map(async (entityId) => {
        const snapshot = await this.candidateRegistry.getEntitySnapshot(entityId);
        if (snapshot === null) {
          throw new Error(`missing_entity_snapshot:${entityId}`);
        }
        return snapshot;
      })
    );

    const vectors: ScorableResidualVector[] = snapshots.map((snapshot) => ({
      ...snapshot,
      createdAt: snapshot.registeredAt
    }));

    const compatibilityBucket = snapshots[0]?.compatibilityBucket;
    if (!compatibilityBucket) {
      throw new Error("missing_compatibility_bucket");
    }

    for (const snapshot of snapshots) {
      if (snapshot.compatibilityBucket !== compatibilityBucket) {
        throw new Error("compatibility_bucket_mismatch");
      }
    }

    const graph = this.overlapGraphBuilder.build(vectors);
    const candidateGroups = this.candidateGroupEnumerator.enumerate(graph, {
      maxParticipants: resolvedConfig.maxParticipants,
      maxUniqueLegs: resolvedConfig.maxUniqueLegs,
      stpMode: resolvedConfig.stpMode
    });

    if (candidateGroups.length === 0) {
      return null;
    }

    const scored = candidateGroups.map((group) => ({
      group,
      score: this.clearingCompressionScorer.score(group, vectors.filter((vector) =>
        group.participantIds.includes(vector.entityId)
      ))
    }));

    scored.sort((left, right) => this.compareScores(left.score, right.score, left.group.participantIds, right.group.participantIds));

    const selected = scored[0];
    if (!selected) {
      return null;
    }

    return {
      compatibilityBucket,
      selectedGroup: selected.group,
      score: selected.score,
      residuals: selected.group.residualAfterNetting,
      participantLockOrder: [...selected.group.participantIds].sort((left, right) => left.localeCompare(right))
    };
  }

  private compareScores(
    left: ClearingCompressionScore,
    right: ClearingCompressionScore,
    leftParticipants: readonly string[],
    rightParticipants: readonly string[]
  ): number {
    const finalScoreDiff = new Decimal(right.finalScore).cmp(left.finalScore);
    if (finalScoreDiff !== 0) {
      return finalScoreDiff;
    }

    const residualDiff = new Decimal(left.postNetAbsResidual).cmp(right.postNetAbsResidual);
    if (residualDiff !== 0) {
      return residualDiff;
    }

    const oldestLeft = new Date(left.tieBreak.oldestParticipantAt).getTime();
    const oldestRight = new Date(right.tieBreak.oldestParticipantAt).getTime();
    if (oldestLeft !== oldestRight) {
      return oldestLeft - oldestRight;
    }

    if (left.tieBreak.participantCount !== right.tieBreak.participantCount) {
      return left.tieBreak.participantCount - right.tieBreak.participantCount;
    }

    return leftParticipants.join("|").localeCompare(rightParticipants.join("|"));
  }
}
