import Decimal from "decimal.js";

import type { IPhase2BCandidateRegistry } from "./phase2b-candidate-registry.js";
import type { IOverlapGraphBuilder } from "./overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "./candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "./clearing-compression-scorer.js";
import type { IResolutionRiskEligibilityService } from "../rfq-engine/resolution-risk-eligibility-service.js";
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
    private readonly clearingCompressionScorer: IClearingCompressionScorer,
    private readonly resolutionRiskEligibilityService?: IResolutionRiskEligibilityService
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

    const eligibleGroups: typeof candidateGroups = [];
    for (const group of candidateGroups) {
      if (await this.isGroupResolutionEligible(group, vectors, bucketId)) {
        eligibleGroups.push(group);
      }
    }

    if (eligibleGroups.length === 0) {
      return null;
    }

    const scored = eligibleGroups.map((group) => ({
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

  private async isGroupResolutionEligible(
    group: { participantIds: readonly string[] },
    vectors: readonly ScorableResidualVector[],
    stableKey: string
  ): Promise<boolean> {
    if (!this.resolutionRiskEligibilityService) {
      return true;
    }

    const vectorsByEntityId = new Map(vectors.map((vector) => [vector.entityId, vector] as const));
    const participantVectors = group.participantIds.map((participantId) => vectorsByEntityId.get(participantId));
    if (participantVectors.some((vector) => vector === undefined)) {
      throw new Error("ambiguous_group_nodes");
    }

    for (let leftIndex = 0; leftIndex < participantVectors.length; leftIndex += 1) {
      const left = participantVectors[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < participantVectors.length; rightIndex += 1) {
        const right = participantVectors[rightIndex]!;
        if (left.resolutionProfileId === right.resolutionProfileId && left.resolutionProfileId !== null && left.resolutionProfileId !== undefined) {
          continue;
        }
        if (!left.resolutionProfileId || !right.resolutionProfileId) {
          return false;
        }

        const safe = await this.resolutionRiskEligibilityService.isSafeForCrossVenueNetting(
          left.resolutionProfileId,
          right.resolutionProfileId,
          { stableKey }
        );
        if (!safe) {
          return false;
        }
      }
    }

    return true;
  }
}
