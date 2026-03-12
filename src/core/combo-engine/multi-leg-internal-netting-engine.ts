import { createHash, randomUUID } from "node:crypto";

import Decimal from "decimal.js";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";

import type {
  ComboNettingCompatibilityInput,
  ComboNettingMatchedLegPair,
  IComboNettingCompatibilityEngine
} from "./combo-netting-compatibility-engine.js";
import type { IComboNettingCandidateRegistry } from "./combo-netting-candidate-registry.js";
import { aggregateNettingExposureDeltas } from "./combo-netting-exposure-aggregation.js";
import type {
  ComboNettingPerLegExposureDelta,
  ComboNettingUserExposureAggregate,
  MultiLegInternalNettingInput,
  MultiLegInternalNettingResult,
  NettingAttemptSnapshot,
  ResidualComboLeg
} from "./types.js";
import type { ResourceLocker } from "./resource-locker.js";
import { withSpan } from "../../observability/tracing.js";
import type { IResolutionRiskEligibilityService } from "../rfq-engine/resolution-risk-eligibility-service.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type {
  ReplayCaptureConfig,
  ReplayComboCandidateSnapshot,
  ReplayEnvelope,
  ReplayMatchedLegPairSnapshot,
  ReplayResolutionEligibilityDecision
} from "../replay/replay.types.js";
import { NettingPhase2ASnapshotBuilder } from "../replay/builders/netting-phase2a-snapshot-builder.js";
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
import type { NettingDecisionOutput } from "../qualification/shadow-qualification-evaluator.js";

type DecimalValue = InstanceType<typeof Decimal>;

interface AuthoritativeComboLegRow {
  id: string;
  combo_rfq_id: string;
  canonical_market_id: string;
  canonical_outcome_id: string;
  side: "buy" | "sell";
  size: string;
  remaining_size: string;
  price_hint: string | null;
  metadata: Record<string, unknown> | null;
}

interface AuthoritativeComboRow {
  id: string;
  user_id: string;
  state: string;
  legs: AuthoritativeComboLegRow[];
}

interface NettingTransactionResult {
  nettingGroupId: string;
  nettedSize: DecimalValue;
  eventsWritten: number;
  incomingResidualLegs: ResidualComboLeg[];
  exhaustedComboIds: string[];
}

interface GroupedExposureBucket {
  userId: string;
  userRole: "userA" | "userB";
  marketId: string;
  side: "buy" | "sell";
  perLeg: ComboNettingPerLegExposureDelta[];
}

interface ComboExposureAggregates {
  userA: ComboNettingUserExposureAggregate;
  userB: ComboNettingUserExposureAggregate;
}

export interface IMultiLegInternalNettingEngine {
  attemptNet(incomingCombo: MultiLegInternalNettingInput): Promise<MultiLegInternalNettingResult>;
  previewNet(incomingCombo: MultiLegInternalNettingInput): Promise<MultiLegInternalNettingResult>;
}

export class MultiLegInternalNettingEngine implements IMultiLegInternalNettingEngine {
  private readonly replaySnapshotBuilder = new NettingPhase2ASnapshotBuilder();

  public constructor(
    private readonly pool: Pool,
    private readonly candidateRegistry: IComboNettingCandidateRegistry,
    private readonly compatibilityEngine: IComboNettingCompatibilityEngine,
    private readonly resourceLocker: ResourceLocker,
    private readonly logger: Logger,
    private readonly resolutionRiskEligibilityService?: IResolutionRiskEligibilityService,
    private readonly replayDecisionCaptureService?: IReplayDecisionCaptureService,
    private readonly replayCaptureConfig?: ReplayCaptureConfig,
    private readonly guardrailConfig?: PerformanceGuardrailConfig,
    private readonly guardrailEvaluator?: IGuardrailEvaluator,
    private readonly degradationManager?: IDegradationManager,
    private readonly replayWriteFailureStatsSource?: IReplayWriteFailureStatsSource,
    private readonly lockWaitStatsSource?: { getCurrentLockWaitMs(): number | Promise<number> },
    private readonly controlPlaneShardId = "netting-phase2a-main",
    private readonly guardrailEnforcementMode?: GuardrailEnforcementMode,
    private readonly phase3AGuardrailShadowResolver?: IPhase3AGuardrailShadowResolver,
    private readonly qualificationHook?: IQualificationRuntimeHook,
    private readonly qualificationConfig?: QualificationDomainHookConfig
  ) {}

  public async attemptNet(incomingCombo: MultiLegInternalNettingInput): Promise<MultiLegInternalNettingResult> {
    this.validateIncomingCombo(incomingCombo);

    return withSpan(
      "combo_internal_netting.attempt",
      {
        combo_id: incomingCombo.id,
        user_id: incomingCombo.userId,
        state: incomingCombo.state ?? "OPEN"
      },
      async () => {
        const previewResult =
          this.qualificationHook && this.qualificationConfig?.enabled && this.qualificationConfig.shadowEnabled
            ? await this.previewNet(incomingCombo)
            : null;
        let authoritativeIncoming = await this.loadCombo(incomingCombo.id);
        this.assertFinalIncoming(authoritativeIncoming, incomingCombo.userId);

        let totalNetted = new Decimal(0);
        let totalEventsWritten = 0;
        const nettingGroupIds = new Set<string>();
        let lastReplayEnvelopeId: string | null = null;

        if (this.comboRemaining(authoritativeIncoming).eq(0)) {
          return this.buildResult(totalNetted, authoritativeIncoming.legs, nettingGroupIds, totalEventsWritten);
        }

        if (!this.isNettableState(authoritativeIncoming.state)) {
          throw new Error(`Incoming combo cannot be netted from state ${authoritativeIncoming.state}.`);
        }

        const candidateIds = await this.candidateRegistry.findCandidateCombos(
          this.toRegistryCombo(authoritativeIncoming)
        );

        const guardrailDecision = await this.evaluateNettingGuardrails({
          incomingCombo: authoritativeIncoming,
          candidateCount: candidateIds.length,
          candidateGroups: candidateIds.length,
          plannerLatencyMs: 0
        });
        if (guardrailDecision?.skipCurrentEngine) {
          return this.buildResult(totalNetted, authoritativeIncoming.legs, nettingGroupIds, totalEventsWritten);
        }

        for (const candidateId of candidateIds) {
          authoritativeIncoming = await this.loadCombo(incomingCombo.id);
          this.assertFinalIncoming(authoritativeIncoming, incomingCombo.userId);

          if (this.comboRemaining(authoritativeIncoming).eq(0)) {
            break;
          }

          if (!this.isNettableState(authoritativeIncoming.state)) {
            throw new Error(`Incoming combo cannot be netted from state ${authoritativeIncoming.state}.`);
          }

          const candidateCombo = await this.loadCombo(candidateId);
          if (candidateCombo === null || !this.isNettableState(candidateCombo.state)) {
            continue;
          }

          const compatibility = this.compatibilityEngine.evaluate(
            this.toCompatibilityInput(authoritativeIncoming),
            this.toCompatibilityInput(candidateCombo)
          );

          if (!compatibility.compatible) {
            continue;
          }

          if (!(await this.isResolutionEligible(authoritativeIncoming, candidateCombo, compatibility.matchedLegPairs))) {
            continue;
          }

          const lockResourceIds = [
            this.resourceLocker.comboLockId(authoritativeIncoming.id),
            this.resourceLocker.comboLockId(candidateCombo.id),
            ...compatibility.matchedLegPairs.flatMap((pair) => [
              this.resourceLocker.comboLegLockId(pair.incomingLegId),
              this.resourceLocker.comboLegLockId(pair.candidateLegId)
            ])
          ].sort((left, right) => left.localeCompare(right));

          const nettableSize = this.resolvePreviewNettableSize(authoritativeIncoming, candidateCombo, compatibility.matchedLegPairs);
          if (nettableSize.lte(0)) {
            continue;
          }

          const replayEnvelope = await this.captureReplayDecision({
            incomingCombo: authoritativeIncoming,
            candidateCombos: [candidateCombo],
            candidateOrder: [candidateCombo.id],
            compatibilityInputs: [
              {
                incomingComboId: authoritativeIncoming.id,
                candidateComboId: candidateCombo.id
              }
            ],
            matchedLegPairOrder: compatibility.matchedLegPairs.map((pair) => ({
              incomingLegId: pair.incomingLegId,
              candidateLegId: pair.candidateLegId,
              marketId: pair.marketId,
              outcomeId: pair.outcomeId,
              matchedSize: nettableSize.toString()
            })),
            resolutionEligibilityDecisions: [
              {
                leftProfileId: this.readComboResolutionProfileId(authoritativeIncoming),
                rightProfileId: this.readComboResolutionProfileId(candidateCombo),
                allowed: true,
                reason: "safe_for_cross_venue_netting",
                stableKey: authoritativeIncoming.id
              }
            ],
            lockResourceIds,
            attemptSnapshots: [
              {
                incomingComboId: authoritativeIncoming.id,
                candidateComboId: candidateCombo.id,
                maxNettableSize: nettableSize.toString()
              }
            ],
            result: {
              nettedSize: nettableSize.toString(),
              candidateComboId: candidateCombo.id
            }
          });
          lastReplayEnvelopeId = replayEnvelope?.id ?? lastReplayEnvelopeId;

          const lockHandle = await this.resourceLocker.acquireLocks(lockResourceIds);

          try {
            const result = await this.executeNettingTransaction(authoritativeIncoming.id, candidateCombo.id);
            if (result === null) {
              continue;
            }

            totalNetted = totalNetted.plus(result.nettedSize);
            totalEventsWritten += result.eventsWritten;
            nettingGroupIds.add(result.nettingGroupId);

            await this.refreshCandidateRegistry(authoritativeIncoming.id, candidateCombo.id, result.exhaustedComboIds);
          } finally {
            await this.resourceLocker.releaseLocks(lockHandle);
          }
        }

        authoritativeIncoming = await this.loadCombo(incomingCombo.id);
        this.assertFinalIncoming(authoritativeIncoming, incomingCombo.userId);

        const result = this.buildResult(totalNetted, authoritativeIncoming.legs, nettingGroupIds, totalEventsWritten);
        await this.emitQualificationEvaluation(incomingCombo, authoritativeIncoming, result, previewResult, lastReplayEnvelopeId);
        return result;
      }
    );
  }

  private async evaluateNettingGuardrails(input: {
    incomingCombo: AuthoritativeComboRow;
    candidateCount: number;
    candidateGroups: number;
    plannerLatencyMs: number;
  }) {
    if (!this.guardrailConfig || !this.guardrailEvaluator || !this.degradationManager) {
      return null;
    }

    const lockWaitMs = this.lockWaitStatsSource ? await this.lockWaitStatsSource.getCurrentLockWaitMs() : 0;
    const enforcementMode =
      this.guardrailEnforcementMode ??
      (
        await this.phase3AGuardrailShadowResolver?.resolve({
          engine: "NETTING_PHASE2A",
          shardId: this.controlPlaneShardId,
          stableId: input.incomingCombo.id,
          marketId: input.incomingCombo.legs[0]?.canonical_market_id ?? null,
        })
      )?.enforcementMode ??
      "ENFORCED";
    return evaluatePlanningGuardrails({
      guardrails: this.guardrailConfig,
      stats: {
        plannerType: "NETTING_PHASE2A",
        plannerLatencyMs: input.plannerLatencyMs,
        bucketEntityCount: input.candidateCount,
        graphEdges: 0,
        candidateGroups: input.candidateGroups,
        lockWaitMs
      },
      context: {
        shardId: this.controlPlaneShardId,
        engine: "NETTING_PHASE2A",
        marketId: input.incomingCombo.legs[0]?.canonical_market_id ?? null
      },
      guardrailEvaluator: this.guardrailEvaluator,
      degradationManager: this.degradationManager,
      replayWriteFailureStatsSource: this.replayWriteFailureStatsSource,
      logger: this.logger,
      requestedBy: "netting-phase2a",
      enforcementMode
    });
  }

  public async previewNet(incomingCombo: MultiLegInternalNettingInput): Promise<MultiLegInternalNettingResult> {
    this.validateIncomingCombo(incomingCombo);

    return withSpan(
      "combo.internal_net.shadow_evaluate",
      {
        combo_id: incomingCombo.id,
        user_id: incomingCombo.userId,
        shadow_mode: true
      },
      async () => {
        const authoritativeIncoming = await this.loadCombo(incomingCombo.id);
        this.assertFinalIncoming(authoritativeIncoming, incomingCombo.userId);

        if (this.comboRemaining(authoritativeIncoming).eq(0) || !this.isNettableState(authoritativeIncoming.state)) {
          return this.buildResult(new Decimal(0), authoritativeIncoming.legs, new Set<string>(), 0);
        }

        const candidateIds = await this.candidateRegistry.findCandidateCombos(
          this.toRegistryCombo(authoritativeIncoming)
        );

        const residualByLegId = new Map(
          authoritativeIncoming.legs.map((leg) => [leg.id, new Decimal(leg.remaining_size)] as const)
        );
        let totalNetted = new Decimal(0);
        const nettingGroupIds = new Set<string>();

        for (const candidateId of candidateIds) {
          const currentIncoming = await this.loadCombo(incomingCombo.id);
          this.assertFinalIncoming(currentIncoming, incomingCombo.userId);
          if (currentIncoming === null) {
            break;
          }

          const candidateCombo = await this.loadCombo(candidateId);
          if (candidateCombo === null || !this.isNettableState(candidateCombo.state)) {
            continue;
          }

          const previewIncoming = this.toPreviewCombo(currentIncoming, residualByLegId);
          if (this.comboRemaining(previewIncoming).eq(0) || !this.isNettableState(previewIncoming.state)) {
            break;
          }

          const compatibility = this.compatibilityEngine.evaluate(
            this.toCompatibilityInput(previewIncoming),
            this.toCompatibilityInput(candidateCombo)
          );
          if (!compatibility.compatible) {
            continue;
          }

          if (!(await this.isResolutionEligible(previewIncoming, candidateCombo, compatibility.matchedLegPairs))) {
            continue;
          }

          const matchedPairs = compatibility.matchedLegPairs.map((pair) => {
            const incomingLeg = previewIncoming.legs.find((leg) => leg.id === pair.incomingLegId);
            const candidateLeg = candidateCombo.legs.find((leg) => leg.id === pair.candidateLegId);
            if (!incomingLeg || !candidateLeg) {
              throw new Error("Matched leg pair missing during combo netting preview.");
            }

            return {
              incomingLeg,
              candidateLeg,
              nettableSize: Decimal.min(
                residualByLegId.get(incomingLeg.id) ?? new Decimal(0),
                new Decimal(candidateLeg.remaining_size)
              )
            };
          });

          const nettableSize = matchedPairs.reduce((smallest, pair) => {
            if (pair.nettableSize.lte(0)) {
              return smallest;
            }
            if (smallest === null || pair.nettableSize.lessThan(smallest)) {
              return pair.nettableSize;
            }
            return smallest;
          }, null as DecimalValue | null);

          if (nettableSize === null || nettableSize.lte(0)) {
            continue;
          }

          for (const pair of matchedPairs) {
            residualByLegId.set(pair.incomingLeg.id, pair.nettableSize.minus(nettableSize));
          }

          totalNetted = totalNetted.plus(nettableSize);
          nettingGroupIds.add(`${incomingCombo.id}:${candidateId}`);
        }

        const previewLegs = authoritativeIncoming.legs.map((leg) => ({
          ...leg,
          remaining_size: (residualByLegId.get(leg.id) ?? new Decimal(leg.remaining_size)).toString()
        }));

        return this.buildResult(totalNetted, previewLegs, nettingGroupIds, 0);
      }
    );
  }

  private async executeNettingTransaction(
    incomingComboId: string,
    candidateComboId: string
  ): Promise<NettingTransactionResult | null> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const authoritativeIncoming = await this.loadComboForUpdate(client, incomingComboId);
      const authoritativeCandidate = await this.loadComboForUpdate(client, candidateComboId);

      if (
        authoritativeIncoming === null ||
        authoritativeCandidate === null ||
        !this.isNettableState(authoritativeIncoming.state) ||
        !this.isNettableState(authoritativeCandidate.state)
      ) {
        await client.query("ROLLBACK");
        return null;
      }

      const compatibility = this.compatibilityEngine.evaluate(
        this.toCompatibilityInput(authoritativeIncoming),
        this.toCompatibilityInput(authoritativeCandidate)
      );

      if (!compatibility.compatible) {
        await client.query("ROLLBACK");
        return null;
      }

      if (!(await this.isResolutionEligible(authoritativeIncoming, authoritativeCandidate, compatibility.matchedLegPairs))) {
        await client.query("ROLLBACK");
        return null;
      }

      const matchedPairs = this.resolveAuthoritativeMatchedPairs(
        authoritativeIncoming,
        authoritativeCandidate,
        compatibility.matchedLegPairs
      );

      const nettableSize = matchedPairs.reduce((smallest, pair) => {
        const candidate = new Decimal(pair.nettableSize);
        if (smallest === null || candidate.lessThan(smallest)) {
          return candidate;
        }

        return smallest;
      }, null as DecimalValue | null);

      if (nettableSize === null || nettableSize.lte(0)) {
        await client.query("ROLLBACK");
        return null;
      }

      const snapshot = this.buildAttemptSnapshot(
        authoritativeIncoming.id,
        authoritativeCandidate.id,
        matchedPairs,
        nettableSize
      );

      const attemptRegistered = await this.registerNettingAttempt(
        client,
        snapshot.attemptId,
        authoritativeIncoming.id,
        authoritativeCandidate.id
      );
      if (!attemptRegistered) {
        await client.query("ROLLBACK");
        return null;
      }

      const nettingGroupId = await this.upsertNettingGroup(
        client,
        authoritativeIncoming.id,
        authoritativeCandidate.id,
        nettableSize
      );

      await this.markNettingAttemptGroup(client, snapshot.attemptId, nettingGroupId);

      const exposureIdempotencyRegistered = await this.registerExposureIdempotency(client, snapshot.attemptId);
      if (!exposureIdempotencyRegistered) {
        await client.query("ROLLBACK");
        return null;
      }

      for (const pair of matchedPairs) {
        await this.upsertMatchedLeg(
          client,
          nettingGroupId,
          pair.incomingLeg.id,
          pair.candidateLeg.id,
          pair.incomingLeg.canonical_market_id,
          pair.incomingLeg.canonical_outcome_id,
          nettableSize,
          pair.price
        );

        await this.updateLegRemaining(
          client,
          pair.incomingLeg.id,
          new Decimal(pair.incomingLeg.remaining_size).minus(nettableSize)
        );
        await this.updateLegRemaining(
          client,
          pair.candidateLeg.id,
          new Decimal(pair.candidateLeg.remaining_size).minus(nettableSize)
        );
      }

      const exposureAggregates = this.buildExposureAggregates(matchedPairs, nettableSize);
      await this.applyExposureAggregates(
        client,
        authoritativeIncoming.user_id,
        authoritativeCandidate.user_id,
        exposureAggregates,
        nettingGroupId,
        snapshot.attemptId,
        authoritativeIncoming.id,
        authoritativeCandidate.id
      );

      const refreshedIncoming = await this.loadComboForUpdate(client, authoritativeIncoming.id);
      const refreshedCandidate = await this.loadComboForUpdate(client, authoritativeCandidate.id);
      if (refreshedIncoming === null || refreshedCandidate === null) {
        throw new Error("Combo disappeared during netting transaction.");
      }

      await this.updateComboState(client, refreshedIncoming.id, this.deriveComboState(refreshedIncoming.legs));
      await this.updateComboState(client, refreshedCandidate.id, this.deriveComboState(refreshedCandidate.legs));

      await this.insertNettingEvent(client, nettingGroupId, "NETTING_APPLIED", {
        incomingComboId: authoritativeIncoming.id,
        matchedComboId: authoritativeCandidate.id,
        matchedLegPairs: snapshot.matchedLegPairs,
        matchedSize: nettableSize.toString(),
        attemptId: snapshot.attemptId
      });

      await client.query("COMMIT");

      return {
        nettingGroupId,
        nettedSize: nettableSize,
        eventsWritten: 1,
        incomingResidualLegs: this.toResidualLegs(refreshedIncoming.legs),
        exhaustedComboIds: [
          ...(this.comboRemaining(refreshedIncoming).eq(0) ? [refreshedIncoming.id] : []),
          ...(this.comboRemaining(refreshedCandidate).eq(0) ? [refreshedCandidate.id] : [])
        ]
      };
    } catch (error) {
      await this.safeRollback(client);
      this.logger.error({ err: error, incomingComboId, candidateComboId }, "Combo internal netting transaction failed.");
      throw error;
    } finally {
      client.release();
    }
  }

  private resolvePreviewNettableSize(
    authoritativeIncoming: AuthoritativeComboRow,
    authoritativeCandidate: AuthoritativeComboRow,
    matchedLegPairs: readonly ComboNettingMatchedLegPair[]
  ): DecimalValue {
    let smallest: DecimalValue | null = null;
    for (const pair of matchedLegPairs) {
      const incomingLeg = authoritativeIncoming.legs.find((leg) => leg.id === pair.incomingLegId);
      const candidateLeg = authoritativeCandidate.legs.find((leg) => leg.id === pair.candidateLegId);
      if (!incomingLeg || !candidateLeg) {
        throw new Error("Matched leg pair missing during replay capture preparation.");
      }

      const candidateSize = Decimal.min(
        new Decimal(incomingLeg.remaining_size),
        new Decimal(candidateLeg.remaining_size)
      );
      if (smallest === null || candidateSize.lessThan(smallest)) {
        smallest = candidateSize;
      }
    }

    return smallest ?? new Decimal(0);
  }

  private readComboResolutionProfileId(combo: AuthoritativeComboRow): string | null {
    const profileIds = new Set(
      combo.legs
        .map((leg) => leg.metadata?.resolution_profile_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    );

    if (profileIds.size !== 1) {
      return null;
    }

    return [...profileIds][0] ?? null;
  }

  private async captureReplayDecision(input: {
    incomingCombo: AuthoritativeComboRow;
    candidateCombos: readonly AuthoritativeComboRow[];
    candidateOrder: readonly string[];
    compatibilityInputs: readonly Record<string, unknown>[];
    matchedLegPairOrder: readonly ReplayMatchedLegPairSnapshot[];
    resolutionEligibilityDecisions: readonly ReplayResolutionEligibilityDecision[];
    lockResourceIds: readonly string[];
    attemptSnapshots: readonly Record<string, unknown>[];
    result: Record<string, unknown>;
  }): Promise<ReplayEnvelope | null> {
    if (!this.replayDecisionCaptureService || !this.replayCaptureConfig) {
      return null;
    }

    const candidateSnapshots: ReplayComboCandidateSnapshot[] = input.candidateCombos.map((combo) => ({
      comboId: combo.id,
      userId: combo.user_id,
      state: combo.state,
      legs: combo.legs as unknown as readonly Record<string, unknown>[]
    }));

    return this.replayDecisionCaptureService.capture({
      config: this.replayCaptureConfig,
      buildEnvelope: (metadata) =>
        this.replaySnapshotBuilder.build({
          ...metadata,
          correlationId: input.incomingCombo.id,
          incomingComboId: input.incomingCombo.id,
          incomingCombo: {
            id: input.incomingCombo.id,
            userId: input.incomingCombo.user_id,
            state: input.incomingCombo.state,
            legs: input.incomingCombo.legs
          },
          candidateCombos: candidateSnapshots,
          candidateOrder: input.candidateOrder,
          compatibilityInputs: input.compatibilityInputs,
          matchedLegPairOrder: input.matchedLegPairOrder,
          resolutionEligibilityDecisions: input.resolutionEligibilityDecisions,
          lockResourceIds: input.lockResourceIds,
          attemptSnapshots: input.attemptSnapshots,
          result: input.result
        })
    });
  }

  private async emitQualificationEvaluation(
    incomingCombo: MultiLegInternalNettingInput,
    authoritativeIncoming: AuthoritativeComboRow,
    result: MultiLegInternalNettingResult,
    previewResult: MultiLegInternalNettingResult | null,
    replayEnvelopeId: string | null
  ): Promise<void> {
    if (!this.qualificationHook || !this.qualificationConfig?.enabled) {
      return;
    }

    const marketIds = [...new Set(authoritativeIncoming.legs.map((leg) => leg.canonical_market_id))];
    const scopeType = marketIds.length === 1 ? "MARKET" : "SHARD";
    const scopeId = marketIds.length === 1 ? marketIds[0]! : this.controlPlaneShardId;
    const liveDecision = this.toNettingDecisionOutput(result);
    const shadowDecision = previewResult ? this.toNettingDecisionOutput(previewResult) : liveDecision;

    await this.qualificationHook.emitEvaluation({
      strategyKey: this.qualificationConfig.strategyKey,
      scopeType,
      scopeId,
      decisionType: "PHASE2A_NETTING_SCOPE_CHANGE",
      entityId: incomingCombo.id,
      replayEnvelopeId,
      mode: previewResult ? "shadow_compare" : "live_only",
      ...(this.qualificationConfig.failMode ? { failMode: this.qualificationConfig.failMode } : {}),
      liveDecision: () => liveDecision,
      shadowDecision: () => shadowDecision,
      metadata: {
        ...(marketIds.length === 1 ? { market: marketIds[0] } : {}),
        shardId: this.controlPlaneShardId
      }
    });
  }

  private toNettingDecisionOutput(result: MultiLegInternalNettingResult): NettingDecisionOutput {
    return {
      nettingGroupIds: [...result.nettingGroupIds].sort((left, right) => left.localeCompare(right)),
      nettedSize: result.nettedSize,
      residualLegs: result.residualLegs.map((leg) => ({
        id: leg.id,
        remainingSize: leg.remainingSize
      }))
    };
  }

  private async loadCombo(comboId: string): Promise<AuthoritativeComboRow | null> {
    const client = await this.pool.connect();

    try {
      return await this.loadComboInternal(client, comboId);
    } finally {
      client.release();
    }
  }

  private async loadComboForUpdate(client: PoolClient, comboId: string): Promise<AuthoritativeComboRow | null> {
    const comboRow = await client.query<{ id: string; user_id: string; state: string }>(
      `SELECT id, user_id, state
         FROM combo_rfqs
        WHERE id = $1
        FOR UPDATE`,
      [comboId]
    );
    const combo = comboRow.rows[0];
    if (!combo) {
      return null;
    }

    const legsResult = await client.query<AuthoritativeComboLegRow>(
      `SELECT id,
              combo_rfq_id,
              canonical_market_id::text,
              canonical_outcome_id::text,
              side,
              size::text,
              remaining_size::text,
              price_hint::text,
              metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC
        FOR UPDATE`,
      [comboId]
    );

    return {
      id: combo.id,
      user_id: combo.user_id,
      state: combo.state,
      legs: legsResult.rows
    };
  }

  private async loadComboInternal(client: PoolClient, comboId: string): Promise<AuthoritativeComboRow | null> {
    const comboRow = await client.query<{ id: string; user_id: string; state: string }>(
      `SELECT id, user_id, state
         FROM combo_rfqs
        WHERE id = $1
        LIMIT 1`,
      [comboId]
    );
    const combo = comboRow.rows[0];
    if (!combo) {
      return null;
    }

    const legsResult = await client.query<AuthoritativeComboLegRow>(
      `SELECT id,
              combo_rfq_id,
              canonical_market_id::text,
              canonical_outcome_id::text,
              side,
              size::text,
              remaining_size::text,
              price_hint::text,
              metadata
         FROM combo_legs
        WHERE combo_rfq_id = $1
        ORDER BY id ASC`,
      [comboId]
    );

    return {
      id: combo.id,
      user_id: combo.user_id,
      state: combo.state,
      legs: legsResult.rows
    };
  }

  private resolveAuthoritativeMatchedPairs(
    incomingCombo: AuthoritativeComboRow,
    candidateCombo: AuthoritativeComboRow,
    matchedLegPairs: readonly ComboNettingMatchedLegPair[]
  ): Array<{
    incomingLeg: AuthoritativeComboLegRow;
    candidateLeg: AuthoritativeComboLegRow;
    nettableSize: string;
    price: string;
  }> {
    return matchedLegPairs.map((pair) => {
      const incomingLeg = incomingCombo.legs.find((leg) => leg.id === pair.incomingLegId);
      const candidateLeg = candidateCombo.legs.find((leg) => leg.id === pair.candidateLegId);

      if (!incomingLeg || !candidateLeg) {
        throw new Error("Matched leg pair missing during authoritative combo reload.");
      }

      const incomingPrice = incomingLeg.price_hint;
      const candidatePrice = candidateLeg.price_hint;
      if (incomingPrice === null || candidatePrice === null) {
        throw new Error("Price hint missing for matched combo leg pair.");
      }

      const nettableSize = Decimal.min(
        new Decimal(incomingLeg.remaining_size),
        new Decimal(candidateLeg.remaining_size)
      ).toString();

      return {
        incomingLeg,
        candidateLeg,
        nettableSize,
        price: candidatePrice
      };
    });
  }

  private async upsertNettingGroup(
    client: PoolClient,
    incomingComboId: string,
    candidateComboId: string,
    matchedSize: DecimalValue
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO combo_netting_groups (id, incoming_combo_id, matched_combo_id, state, matched_size)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (incoming_combo_id, matched_combo_id)
       DO UPDATE
          SET matched_size = combo_netting_groups.matched_size + EXCLUDED.matched_size,
              state = EXCLUDED.state
       RETURNING id`,
      [randomUUID(), incomingComboId, candidateComboId, "MATCHED", matchedSize.toString()]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to upsert combo netting group.");
    }

    return row.id;
  }

  private async upsertMatchedLeg(
    client: PoolClient,
    nettingGroupId: string,
    incomingLegId: string,
    matchedLegId: string,
    marketId: string,
    outcomeId: string,
    matchedSize: DecimalValue,
    price: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO combo_netting_match_legs
         (id, netting_group_id, incoming_leg_id, matched_leg_id, market_id, outcome_id, matched_size, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (netting_group_id, incoming_leg_id, matched_leg_id)
       DO UPDATE
          SET matched_size = combo_netting_match_legs.matched_size + EXCLUDED.matched_size,
              price = EXCLUDED.price`,
      [randomUUID(), nettingGroupId, incomingLegId, matchedLegId, marketId, outcomeId, matchedSize.toString(), price]
    );
  }

  private async updateLegRemaining(client: PoolClient, legId: string, remaining: DecimalValue): Promise<void> {
    await client.query(
      `UPDATE combo_legs
          SET remaining_size = $1
        WHERE id = $2`,
      [remaining.toString(), legId]
    );
  }

  private async updateComboState(client: PoolClient, comboId: string, state: "PARTIALLY_EXECUTED" | "EXECUTED"): Promise<void> {
    await client.query(
      `UPDATE combo_rfqs
          SET state = $1
        WHERE id = $2`,
      [state, comboId]
    );
  }

  private async registerNettingAttempt(
    client: PoolClient,
    attemptId: string,
    incomingComboId: string,
    matchedComboId: string
  ): Promise<boolean> {
    const result = await client.query<{ attempt_id: string }>(
      `INSERT INTO combo_netting_attempts (attempt_id, incoming_combo_id, matched_combo_id, status)
       VALUES ($1, $2, $3, 'APPLIED')
       ON CONFLICT (attempt_id) DO NOTHING
       RETURNING attempt_id`,
      [attemptId, incomingComboId, matchedComboId]
    );

    return result.rows.length === 1;
  }

  private async markNettingAttemptGroup(
    client: PoolClient,
    attemptId: string,
    nettingGroupId: string
  ): Promise<void> {
    await client.query(
      `UPDATE combo_netting_attempts
          SET netting_group_id = $1
        WHERE attempt_id = $2`,
      [nettingGroupId, attemptId]
    );
  }

  private async registerExposureIdempotency(client: PoolClient, attemptId: string): Promise<boolean> {
    const id = this.attemptIdToUuid(attemptId);
    const result = await client.query<{ id: string }>(
      `INSERT INTO exposure_idempotency (id)
       VALUES ($1)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id]
    );

    return result.rows.length === 1;
  }

  private async insertNettingEvent(
    client: PoolClient,
    nettingGroupId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO combo_netting_events (id, netting_group_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [randomUUID(), nettingGroupId, eventType, JSON.stringify(payload)]
    );
  }

  private buildExposureAggregates(
    matchedPairs: Array<{
      incomingLeg: AuthoritativeComboLegRow;
      candidateLeg: AuthoritativeComboLegRow;
      nettableSize: string;
      price: string;
    }>,
    nettableSize: DecimalValue
  ): ComboExposureAggregates {
    return aggregateNettingExposureDeltas({
      matchedLegs: matchedPairs.map((pair) => ({
        incomingLegId: pair.incomingLeg.id,
        incomingSide: pair.incomingLeg.side,
        candidateLegId: pair.candidateLeg.id,
        candidateSide: pair.candidateLeg.side,
        marketId: pair.incomingLeg.canonical_market_id,
        outcomeId: pair.incomingLeg.canonical_outcome_id,
        matchedSize: nettableSize.toString(),
        price: pair.price
      }))
    });
  }

  private async applyExposureAggregates(
    client: PoolClient,
    incomingUserId: string,
    candidateUserId: string,
    aggregates: ComboExposureAggregates,
    nettingGroupId: string,
    attemptId: string,
    incomingComboId: string,
    matchedComboId: string
  ): Promise<void> {
    const groupedBuckets = [
      ...this.groupExposureAggregateByMarketAndSide(incomingUserId, "userA", aggregates.userA),
      ...this.groupExposureAggregateByMarketAndSide(candidateUserId, "userB", aggregates.userB)
    ];

    for (const bucket of groupedBuckets) {
      await this.applyExposureGroup(
        client,
        bucket,
        nettingGroupId,
        attemptId,
        incomingComboId,
        matchedComboId,
        aggregates
      );
    }
  }

  private groupExposureAggregateByMarketAndSide(
    userId: string,
    userRole: "userA" | "userB",
    aggregate: ComboNettingUserExposureAggregate
  ): GroupedExposureBucket[] {
    const grouped = new Map<string, GroupedExposureBucket>();

    for (const perLeg of aggregate.perLeg) {
      const key = `${perLeg.marketId}:${perLeg.side}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.perLeg.push(perLeg);
        continue;
      }

      grouped.set(key, {
        userId,
        userRole,
        marketId: perLeg.marketId,
        side: perLeg.side,
        perLeg: [perLeg]
      });
    }

    return [...grouped.values()];
  }

  private async applyExposureGroup(
    client: PoolClient,
    bucket: GroupedExposureBucket,
    nettingGroupId: string,
    attemptId: string,
    incomingComboId: string,
    matchedComboId: string,
    aggregates: ComboExposureAggregates
  ): Promise<void> {
    const grossDelta = bucket.perLeg.reduce(
      (sum, leg) => sum.plus(leg.maxLossDelta),
      new Decimal(0)
    );
    const netDelta = bucket.perLeg.reduce(
      (sum, leg) => sum.plus(new Decimal(leg.maxGainDelta).minus(new Decimal(leg.maxLossDelta))),
      new Decimal(0)
    );

    const exposureRow = await client.query<{ id: string; gross_notional: string; net_notional: string }>(
      `SELECT id, gross_notional::text, net_notional::text
         FROM exposure
        WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3
        FOR UPDATE`,
      [bucket.userId, bucket.marketId, bucket.side]
    );

    const existing = exposureRow.rows[0];
    const prevGross = existing ? new Decimal(existing.gross_notional) : new Decimal(0);
    const prevNet = existing ? new Decimal(existing.net_notional) : new Decimal(0);
    const newGross = prevGross.plus(grossDelta);
    const newNet = prevNet.plus(netDelta);

    let exposureId = existing?.id;

    if (!exposureId) {
      const created = await client.query<{ id: string }>(
        `INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [bucket.userId, bucket.marketId, bucket.side, newGross.toString(), newNet.toString()]
      );
      exposureId = created.rows[0]?.id;
    } else {
      await client.query(
        `UPDATE exposure
            SET gross_notional = $1,
                net_notional = $2,
                last_updated = NOW(),
                version = version + 1
          WHERE id = $3`,
        [newGross.toString(), newNet.toString(), exposureId]
      );
    }

    if (!exposureId) {
      throw new Error("Failed to upsert combo netting exposure row.");
    }

    await client.query(
        `INSERT INTO exposure_journal
         (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        exposureId,
        netDelta.toString(),
        prevGross.toString(),
        prevNet.toString(),
        newGross.toString(),
        newNet.toString(),
        "combo-internal-net",
        nettingGroupId,
        JSON.stringify({
          incomingComboId,
          matchedComboId,
          attemptId,
          userRole: bucket.userRole,
          marketId: bucket.marketId,
          side: bucket.side,
          aggregateMaxLossDelta:
            bucket.userRole === "userA" ? aggregates.userA.maxLossDelta : aggregates.userB.maxLossDelta,
          aggregateMaxGainDelta:
            bucket.userRole === "userA" ? aggregates.userA.maxGainDelta : aggregates.userB.maxGainDelta,
          groupedMaxLossDelta: grossDelta.toString(),
          groupedMaxGainDelta: bucket.perLeg
            .reduce((sum, leg) => sum.plus(leg.maxGainDelta), new Decimal(0))
            .toString(),
          perLeg: bucket.perLeg
        })
      ]
    );
  }

  private async refreshCandidateRegistry(
    incomingComboId: string,
    candidateComboId: string,
    exhaustedComboIds: readonly string[]
  ): Promise<void> {
    const comboIds = [incomingComboId, candidateComboId];

    for (const comboId of comboIds) {
      try {
        await this.candidateRegistry.unregisterComboCandidate(comboId);
        if (!exhaustedComboIds.includes(comboId)) {
          const combo = await this.loadCombo(comboId);
          if (combo && this.comboRemaining(combo).gt(0)) {
            await this.candidateRegistry.registerComboCandidate(this.toRegistryCombo(combo));
          }
        }
      } catch (error) {
        this.logger.error({ err: error, comboId }, "Failed to refresh combo netting candidate registry after commit.");
      }
    }
  }

  private toRegistryCombo(combo: AuthoritativeComboRow): { id: string; legs: readonly { id: string; marketId: string; outcomeId: string; side: "buy" | "sell" }[] } {
    return {
      id: combo.id,
      legs: combo.legs
        .filter((leg) => new Decimal(leg.remaining_size).gt(0))
        .map((leg) => ({
          id: leg.id,
          marketId: leg.canonical_market_id,
          outcomeId: leg.canonical_outcome_id,
          side: leg.side
        }))
    };
  }

  private toPreviewCombo(
    combo: AuthoritativeComboRow,
    residualByLegId: ReadonlyMap<string, DecimalValue>
  ): AuthoritativeComboRow {
    return {
      ...combo,
      legs: combo.legs.map((leg) => ({
        ...leg,
        remaining_size: (residualByLegId.get(leg.id) ?? new Decimal(leg.remaining_size)).toString()
      }))
    };
  }

  private toCompatibilityInput(combo: AuthoritativeComboRow): ComboNettingCompatibilityInput {
    return {
      id: combo.id,
      userId: combo.user_id,
      legs: combo.legs
        .filter((leg) => new Decimal(leg.remaining_size).gt(0))
        .map((leg) => ({
          id: leg.id,
          canonicalMarketId: leg.canonical_market_id,
          canonicalOutcomeId: leg.canonical_outcome_id,
          side: leg.side,
          quantity: leg.remaining_size,
          ...(leg.price_hint !== null ? { priceHint: leg.price_hint } : {})
        }))
    };
  }

  private toResidualLegs(legs: readonly AuthoritativeComboLegRow[]): ResidualComboLeg[] {
    return legs
      .filter((leg) => new Decimal(leg.remaining_size).gt(0))
      .map((leg) => ({
        id: leg.id,
        canonicalMarketId: leg.canonical_market_id,
        canonicalOutcomeId: leg.canonical_outcome_id,
        side: leg.side,
        remainingSize: leg.remaining_size,
        ...(leg.price_hint !== null ? { priceHint: leg.price_hint } : {}),
        ...(leg.metadata ? { metadata: leg.metadata } : {})
      }));
  }

  private buildAttemptSnapshot(
    incomingComboId: string,
    candidateComboId: string,
    matchedPairs: Array<{ incomingLeg: AuthoritativeComboLegRow; candidateLeg: AuthoritativeComboLegRow; nettableSize: string }>,
    nettableSize: DecimalValue
  ): NettingAttemptSnapshot {
    const matchedLegPairs = matchedPairs
      .map((pair) => ({
        incomingLegId: pair.incomingLeg.id,
        candidateLegId: pair.candidateLeg.id,
        matchedSize: nettableSize.toString()
      }))
      .sort((left, right) =>
        `${left.incomingLegId}:${left.candidateLegId}`.localeCompare(
          `${right.incomingLegId}:${right.candidateLegId}`
        )
      );

    const hash = createHash("sha256");
    hash.update(
      JSON.stringify({
        incomingComboId,
        candidateComboId,
        matchedLegPairs,
        maxNettableSize: nettableSize.toString()
      })
    );

    return {
      incomingComboId,
      candidateComboId,
      matchedLegPairs,
      maxNettableSize: nettableSize.toString(),
      attemptId: hash.digest("hex")
    };
  }

  private attemptIdToUuid(attemptId: string): string {
    const hex = attemptId.replace(/-/g, "").slice(0, 32).padEnd(32, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  private buildResult(
    totalNetted: DecimalValue,
    incomingLegs: readonly AuthoritativeComboLegRow[],
    nettingGroupIds: ReadonlySet<string>,
    eventsWritten: number
  ): MultiLegInternalNettingResult {
    const residualLegs = this.toResidualLegs(incomingLegs);

    return {
      nettedSize: totalNetted.toString(),
      residualLegs,
      residualRemaining: residualLegs.length > 0,
      nettingGroupIds: [...nettingGroupIds],
      eventsWritten
    };
  }

  private comboRemaining(combo: AuthoritativeComboRow): DecimalValue {
    return combo.legs.reduce((sum, leg) => sum.plus(leg.remaining_size), new Decimal(0));
  }

  private deriveComboState(legs: readonly AuthoritativeComboLegRow[]): "PARTIALLY_EXECUTED" | "EXECUTED" {
    return legs.some((leg) => new Decimal(leg.remaining_size).gt(0)) ? "PARTIALLY_EXECUTED" : "EXECUTED";
  }

  private validateIncomingCombo(combo: MultiLegInternalNettingInput): void {
    if (combo.id.trim().length === 0 || combo.userId.trim().length === 0) {
      throw new Error("incomingCombo.id and incomingCombo.userId are required.");
    }

    if (combo.legs.length === 0) {
      throw new Error("incomingCombo.legs must not be empty.");
    }
  }

  private assertAuthoritativeIncoming(combo: AuthoritativeComboRow | null, expectedUserId: string): asserts combo is AuthoritativeComboRow {
    if (combo === null) {
      throw new Error("Incoming combo not found.");
    }

    if (combo.user_id !== expectedUserId) {
      throw new Error("Incoming combo user mismatch.");
    }

    if (!this.isNettableState(combo.state)) {
      throw new Error(`Incoming combo cannot be netted from state ${combo.state}.`);
    }
  }

  private assertFinalIncoming(combo: AuthoritativeComboRow | null, expectedUserId: string): asserts combo is AuthoritativeComboRow {
    if (combo === null) {
      throw new Error("Incoming combo not found.");
    }

    if (combo.user_id !== expectedUserId) {
      throw new Error("Incoming combo user mismatch.");
    }
  }

  private isNettableState(state: string): boolean {
    return state === "OPEN" || state === "PARTIALLY_EXECUTED" || state === "ACCEPTED";
  }

  private async safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (error) {
      this.logger.warn({ err: error }, "Rollback failed during combo internal netting.");
    }
  }

  private async isResolutionEligible(
    incomingCombo: AuthoritativeComboRow,
    candidateCombo: AuthoritativeComboRow,
    matchedLegPairs: readonly ComboNettingMatchedLegPair[]
  ): Promise<boolean> {
    if (!this.resolutionRiskEligibilityService) {
      return true;
    }

    if (matchedLegPairs.length === 0) {
      return false;
    }

    const incomingProfileId = this.resolveComboResolutionProfileId(incomingCombo);
    const candidateProfileId = this.resolveComboResolutionProfileId(candidateCombo);

    if (incomingProfileId && candidateProfileId && incomingProfileId === candidateProfileId) {
      return true;
    }

    if (!incomingProfileId || !candidateProfileId) {
      return false;
    }

    return this.resolutionRiskEligibilityService.isSafeForCrossVenueNetting(
      incomingProfileId,
      candidateProfileId,
      { stableKey: incomingCombo.id }
    );
  }

  private resolveComboResolutionProfileId(combo: AuthoritativeComboRow): string | null {
    const profileIds = new Set<string>();

    for (const leg of combo.legs) {
      if (new Decimal(leg.remaining_size).lte(0)) {
        continue;
      }
      const value = leg.metadata?.["resolution_profile_id"];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("invalid_resolution_profile_id");
      }
      profileIds.add(value);
    }

    if (profileIds.size > 1) {
      throw new Error("ambiguous_resolution_profile_id");
    }

    const profileId = profileIds.values().next().value;
    return typeof profileId === "string" ? profileId : null;
  }
}
