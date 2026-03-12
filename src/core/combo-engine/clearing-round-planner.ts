import Decimal from "decimal.js";
import type { Logger } from "pino";

import type { IPhase2BCandidateRegistry } from "./phase2b-candidate-registry.js";
import type { IOverlapGraphBuilder } from "./overlap-graph-builder.js";
import type { ICandidateGroupEnumerator } from "./candidate-group-enumerator.js";
import type { IClearingCompressionScorer } from "./clearing-compression-scorer.js";
import type { IResolutionRiskEligibilityService } from "../rfq-engine/resolution-risk-eligibility-service.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type {
  ReplayCaptureConfig,
  ReplayEnvelope,
  ReplayClearingScoreSnapshot,
  ReplayResolutionEligibilityDecision
} from "../replay/replay.types.js";
import { ClearingPhase2BSnapshotBuilder } from "../replay/builders/clearing-phase2b-snapshot-builder.js";
import type { PerformanceGuardrailConfig } from "../../guardrails/guardrail-config.js";
import type { IGuardrailEvaluator } from "../../guardrails/guardrail-evaluator.js";
import type { IDegradationManager } from "../../guardrails/degradation-manager.js";
import {
  evaluatePlanningGuardrails,
  type GuardrailEnforcementMode,
  type IReplayWriteFailureStatsSource
} from "../../guardrails/planning-guardrail-helper.js";
import type { IPhase3AGuardrailShadowResolver } from "../../guardrails/phase3a-guardrail-shadow.js";
import type {
  IQualificationRuntimeHook,
  QualificationDomainHookConfig
} from "../qualification/runtime-qualification-hook.js";
import type { ClearingDecisionOutput } from "../qualification/shadow-qualification-evaluator.js";
import type {
  CandidateGroup,
  ClearingCompressionScore,
  ClearingRoundPlan,
  ClearingRoundPlannerConfig,
  OverlapGraph,
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
  private readonly replaySnapshotBuilder = new ClearingPhase2BSnapshotBuilder();

  public constructor(
    private readonly candidateRegistry: IPhase2BCandidateRegistry,
    private readonly overlapGraphBuilder: IOverlapGraphBuilder,
    private readonly candidateGroupEnumerator: ICandidateGroupEnumerator,
    private readonly clearingCompressionScorer: IClearingCompressionScorer,
    private readonly resolutionRiskEligibilityService?: IResolutionRiskEligibilityService,
    private readonly replayDecisionCaptureService?: IReplayDecisionCaptureService,
    private readonly replayCaptureConfig?: ReplayCaptureConfig,
    private readonly guardrailConfig?: PerformanceGuardrailConfig,
    private readonly guardrailEvaluator?: IGuardrailEvaluator,
    private readonly degradationManager?: IDegradationManager,
    private readonly replayWriteFailureStatsSource?: IReplayWriteFailureStatsSource,
    private readonly controlPlaneShardId = "clearing-phase2b-main",
    private readonly logger?: Pick<Logger, "info" | "warn" | "error">,
    private readonly guardrailEnforcementMode?: GuardrailEnforcementMode,
    private readonly phase3AGuardrailShadowResolver?: IPhase3AGuardrailShadowResolver,
    private readonly qualificationHook?: IQualificationRuntimeHook,
    private readonly qualificationConfig?: QualificationDomainHookConfig,
    private readonly qualificationShadowDecisionBuilder?: (input: {
      bucketId: string;
      plannerConfig: ClearingRoundPlannerConfig;
      candidateSnapshots: readonly Record<string, unknown>[];
      bucketEntityOrder: readonly string[];
      overlapGraph: Record<string, unknown>;
      enumeratedGroups: readonly Record<string, unknown>[];
      selectedPlan: Record<string, unknown>;
    }) => Promise<ClearingDecisionOutput> | ClearingDecisionOutput
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

    const preflightGuardrailDecision = await this.evaluateClearingGuardrails({
      bucketId,
      bucketEntityCount: page.entityIds.length,
      graphEdges: 0,
      candidateGroups: 0,
      plannerLatencyMs: 0
    });
    if (preflightGuardrailDecision?.skipCurrentEngine) {
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
    const resolutionEligibilityExclusions: ReplayResolutionEligibilityDecision[] = [];
    for (const group of candidateGroups) {
      if (await this.isGroupResolutionEligible(group, vectors, bucketId, resolutionEligibilityExclusions)) {
        eligibleGroups.push(group);
      }
    }

    if (eligibleGroups.length === 0) {
      return null;
    }

    const postEnumerationGuardrailDecision = await this.evaluateClearingGuardrails({
      bucketId,
      bucketEntityCount: page.entityIds.length,
      graphEdges: graph.edges.length,
      candidateGroups: eligibleGroups.length,
      plannerLatencyMs: 0
    });
    if (postEnumerationGuardrailDecision?.skipCurrentEngine) {
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

    const plan = {
      compatibilityBucket,
      selectedGroup: selected.group,
      score: selected.score,
      residuals: selected.group.residualAfterNetting,
      participantLockOrder: [...selected.group.participantIds].sort((left, right) => left.localeCompare(right))
    };

    const replayEnvelope = await this.captureReplayDecision({
      bucketId,
      plannerConfig: resolvedConfig as unknown as Record<string, unknown>,
      candidateSnapshots: snapshots as unknown as readonly Record<string, unknown>[],
      bucketEntityOrder: page.entityIds,
      overlapGraph: graph as unknown as Record<string, unknown>,
      enumeratedGroups: candidateGroups as unknown as readonly Record<string, unknown>[],
      scoreSnapshots: scored.map((entry) => ({
        participantIds: entry.group.participantIds,
        score: entry.score as unknown as Record<string, unknown>
      })),
      resolutionEligibilityExclusions,
      selectedPlan: plan as unknown as Record<string, unknown>
    });

    await this.emitQualificationEvaluation({
      bucketId,
      resolvedConfig,
      snapshots: snapshots as unknown as readonly Record<string, unknown>[],
      page,
      graph,
      candidateGroups,
      plan,
      replayEnvelopeId: replayEnvelope?.id ?? null
    });

    return plan;
  }

  private async evaluateClearingGuardrails(input: {
    bucketId: string;
    bucketEntityCount: number;
    graphEdges: number;
    candidateGroups: number;
    plannerLatencyMs: number;
  }) {
    if (!this.guardrailConfig || !this.guardrailEvaluator || !this.degradationManager) {
      return null;
    }

    const enforcementMode =
      this.guardrailEnforcementMode ??
      (
        await this.phase3AGuardrailShadowResolver?.resolve({
          engine: "CLEARING_PHASE2B",
          shardId: this.controlPlaneShardId,
          bucketId: input.bucketId,
          stableId: input.bucketId,
        })
      )?.enforcementMode ??
      "ENFORCED";

    return evaluatePlanningGuardrails({
      guardrails: this.guardrailConfig,
      stats: {
        plannerType: "CLEARING_PHASE2B",
        plannerLatencyMs: input.plannerLatencyMs,
        bucketEntityCount: input.bucketEntityCount,
        graphEdges: input.graphEdges,
        candidateGroups: input.candidateGroups,
        lockWaitMs: 0
      },
      context: {
        shardId: this.controlPlaneShardId,
        bucketId: input.bucketId,
        engine: "CLEARING_PHASE2B"
      },
      guardrailEvaluator: this.guardrailEvaluator,
      degradationManager: this.degradationManager,
      replayWriteFailureStatsSource: this.replayWriteFailureStatsSource,
      logger: this.logger ?? { info() {}, warn() {}, error() {} },
      enforcementMode
    });
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
    stableKey: string,
    exclusions: ReplayResolutionEligibilityDecision[]
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
          exclusions.push({
            leftProfileId: left.resolutionProfileId ?? null,
            rightProfileId: right.resolutionProfileId ?? null,
            allowed: false,
            reason: "missing_profile_mapping",
            stableKey
          });
          return false;
        }

        const safe = await this.resolutionRiskEligibilityService.isSafeForCrossVenueNetting(
          left.resolutionProfileId,
          right.resolutionProfileId,
          { stableKey }
        );
        if (!safe) {
          exclusions.push({
            leftProfileId: left.resolutionProfileId,
            rightProfileId: right.resolutionProfileId,
            allowed: false,
            reason: "resolution_profile_not_safe",
            stableKey
          });
          return false;
        }
      }
    }

    return true;
  }

  private async captureReplayDecision(input: {
    bucketId: string;
    plannerConfig: Record<string, unknown>;
    candidateSnapshots: readonly Record<string, unknown>[];
    bucketEntityOrder: readonly string[];
    overlapGraph: Record<string, unknown>;
    enumeratedGroups: readonly Record<string, unknown>[];
    scoreSnapshots: readonly ReplayClearingScoreSnapshot[];
    resolutionEligibilityExclusions: readonly ReplayResolutionEligibilityDecision[];
    selectedPlan: Record<string, unknown>;
  }): Promise<ReplayEnvelope | null> {
    if (!this.replayDecisionCaptureService || !this.replayCaptureConfig) {
      return null;
    }

    return this.replayDecisionCaptureService.capture({
      config: this.replayCaptureConfig,
      buildEnvelope: (metadata) =>
        this.replaySnapshotBuilder.build({
          ...metadata,
          correlationId: input.bucketId,
          ...input
        })
    });
  }

  private async emitQualificationEvaluation(input: {
    bucketId: string;
    resolvedConfig: ClearingRoundPlannerConfig;
    snapshots: readonly Record<string, unknown>[];
    page: { entityIds: readonly string[] };
    graph: OverlapGraph;
    candidateGroups: readonly CandidateGroup[];
    plan: ClearingRoundPlan;
    replayEnvelopeId: string | null;
  }): Promise<void> {
    if (!this.qualificationHook || !this.qualificationConfig?.enabled) {
      return;
    }

    const liveDecision = this.toClearingDecisionOutput(input.plan);
    const shadowDecision = this.qualificationShadowDecisionBuilder
      ? await this.qualificationShadowDecisionBuilder({
          bucketId: input.bucketId,
          plannerConfig: input.resolvedConfig,
          candidateSnapshots: input.snapshots,
          bucketEntityOrder: input.page.entityIds,
          overlapGraph: input.graph as unknown as Record<string, unknown>,
          enumeratedGroups: input.candidateGroups as unknown as readonly Record<string, unknown>[],
          selectedPlan: input.plan as unknown as Record<string, unknown>
        })
      : liveDecision;

    await this.qualificationHook.emitEvaluation({
      strategyKey: this.qualificationConfig.strategyKey,
      scopeType: "BUCKET",
      scopeId: input.bucketId,
      decisionType: "PHASE2B_CLEARING_STRATEGY_CHANGE",
      entityId: input.bucketId,
      replayEnvelopeId: input.replayEnvelopeId,
      mode: this.qualificationShadowDecisionBuilder && this.qualificationConfig.shadowEnabled ? "shadow_compare" : "live_only",
      ...(this.qualificationConfig.failMode ? { failMode: this.qualificationConfig.failMode } : {}),
      liveDecision: () => liveDecision,
      shadowDecision: () => shadowDecision,
      metadata: {
        bucketId: input.bucketId
      }
    });
  }

  private toClearingDecisionOutput(plan: ClearingRoundPlan): ClearingDecisionOutput {
    return {
      clearingRoundId: plan.compatibilityBucket,
      participantSetHash: [...plan.selectedGroup.participantIds].sort((left, right) => left.localeCompare(right)).join("|"),
      matchSignatureHash: plan.participantLockOrder.join("|"),
      compressionScore: plan.score.compressionScore,
      residuals: plan.residuals.map((residual) => ({
        key: residual.key,
        signedResidual: residual.signedResidual
      }))
    };
  }
}
