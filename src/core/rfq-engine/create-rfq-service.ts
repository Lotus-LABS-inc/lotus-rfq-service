import { randomUUID } from "node:crypto";
import { RFQEventRepository } from "../../db/repositories/rfq-event-repository.js";
import { RFQSessionRepository } from "../../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "./rfq-session-manager.js";
import { RFQStateMachine, type RFQStateMachineLogger } from "./rfq-state-machine.js";
import type { CanonicalMarketClient } from "./canonical-market-client.js";
import type { RFQEventEmitter } from "./rfq-domain-events.js";
import type { ReliabilityWeights } from "../lp-reliability-engine.js";
import {
  activeRFQSessions,
  rfqCreatedTotal,
  rfqResolutionBlockedTotal,
  rfqResolutionSafePoolTotal,
  rfqResolutionSeparatedTotal
} from "../../observability/metrics.js";
import { withLatencyStage } from "../../observability/latency.js";
import { withSpan } from "../../observability/tracing.js";
import type { IRiskEngine } from "../risk-engine.js";
import type { IResolutionRiskGroupingService } from "./resolution-risk-grouping-service.js";
import type { ResolutionRiskVenueGrouping } from "./resolution-risk.types.js";
import type { IResolutionRiskPolicyService } from "./resolution-risk-policy-service.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type { ReplayCaptureConfig, ReplayEnvelope } from "../replay/replay.types.js";
import { RFQGroupingSnapshotBuilder } from "../replay/builders/rfq-grouping-snapshot-builder.js";
import type {
  IQualificationRuntimeHook,
  QualificationDomainHookConfig
} from "../qualification/runtime-qualification-hook.js";

export interface CreateRFQCommand {
  canonicalMarketId: string;
  takerId: string;
  side: "buy" | "sell";
  quantity: string;
  idempotencyKey: string;
  ttlSeconds: number;
}

export interface CreateRFQResult {
  sessionId: string;
  state: "BROADCAST";
  expiresAt: string;
}

export interface CreateRFQServiceDependencies {
  sessionRepository: RFQSessionRepository;
  eventRepository: RFQEventRepository;
  sessionManager: RFQSessionManager;
  canonicalMarketClient: CanonicalMarketClient;
  eventEmitter: RFQEventEmitter;
  logger: RFQStateMachineLogger;
  now?: () => Date;
  createRequestId?: () => string;
  riskEngine: IRiskEngine;
  resolutionRiskGroupingService: IResolutionRiskGroupingService;
  resolutionRiskPolicyService?: IResolutionRiskPolicyService;
  replayDecisionCaptureService?: IReplayDecisionCaptureService;
  replayCaptureConfig?: ReplayCaptureConfig;
  qualificationHook?: IQualificationRuntimeHook;
  qualificationConfig?: QualificationDomainHookConfig;
}

export class MarketInactiveError extends Error {
  public constructor(marketId: string) {
    super(`Canonical market ${marketId} is not active.`);
    this.name = "MarketInactiveError";
  }
}

export class CanonicalMarketResolutionMetadataError extends Error {
  public constructor(marketId: string) {
    super(`Canonical market ${marketId} is missing canonicalEventId required for resolution risk grouping.`);
    this.name = "CanonicalMarketResolutionMetadataError";
  }
}

export class CreateRFQService {
  private readonly now: () => Date;
  private readonly createRequestId: () => string;
  private readonly replaySnapshotBuilder = new RFQGroupingSnapshotBuilder();

  public constructor(private readonly deps: CreateRFQServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.createRequestId = deps.createRequestId ?? (() => randomUUID());
  }

  public async execute(
    command: CreateRFQCommand,
    options?: { weights?: Partial<ReliabilityWeights> }
  ): Promise<CreateRFQResult> {
    return withSpan(
      "rfq.lifecycle.create",
      {
        rfq_id: "pending",
        lp_id: "n/a",
        state: "CREATED"
      },
      async () => {
        const market = await withLatencyStage("canonical_lookup", {
          endpoint: "POST /rfq",
          canonicalMarketId: command.canonicalMarketId
        }, () => this.deps.canonicalMarketClient.fetchMarketById(command.canonicalMarketId));
        if (!market.isActive) {
          throw new MarketInactiveError(command.canonicalMarketId);
        }
        if (!market.canonicalEventId) {
          throw new CanonicalMarketResolutionMetadataError(command.canonicalMarketId);
        }
        const canonicalEventId = market.canonicalEventId;

        const rawResolutionRiskGroupingTrace = await withLatencyStage("resolution_routeability_lookup", {
          endpoint: "POST /rfq",
          canonicalMarketId: command.canonicalMarketId
        }, () => this.deps.resolutionRiskGroupingService.groupProfilesForCanonicalEventWithTrace(
          canonicalEventId
        ));
        const rawResolutionRiskGrouping = rawResolutionRiskGroupingTrace.grouping;
        const resolutionRiskPolicy = this.deps.resolutionRiskPolicyService?.applyRFQGrouping(
          rawResolutionRiskGrouping,
          command.idempotencyKey
        );
        const resolutionRiskGrouping = resolutionRiskPolicy?.grouping ?? rawResolutionRiskGrouping;
        const resolutionRiskShadowGrouping = resolutionRiskPolicy?.shadowGrouping;

        const replayEnvelope: ReplayEnvelope | null =
          this.deps.replayDecisionCaptureService && this.deps.replayCaptureConfig
            ? await this.deps.replayDecisionCaptureService.capture({
            config: this.deps.replayCaptureConfig,
            buildEnvelope: (metadata) =>
              this.replaySnapshotBuilder.build({
                ...metadata,
                correlationId: command.idempotencyKey,
                rfqId: command.idempotencyKey,
                canonicalEventId,
                orderedCandidateProfiles: rawResolutionRiskGroupingTrace.orderedProfiles as unknown as readonly Record<string, unknown>[],
                orderedAssessments: rawResolutionRiskGroupingTrace.orderedAssessments as unknown as readonly Record<string, unknown>[],
                pairGenerationOrder: rawResolutionRiskGroupingTrace.pairGenerationOrder,
                grouping: resolutionRiskGrouping as unknown as Record<string, unknown>
              })
            })
            : null;

        try {
          await withLatencyStage("rfq_create_risk_validation", {
            endpoint: "POST /rfq",
            canonicalMarketId: command.canonicalMarketId
          }, () => this.deps.riskEngine.validateRFQCreation({
            taker_id: command.takerId,
            canonical_market_id: command.canonicalMarketId,
            side: command.side,
            quantity: command.quantity
          }));
        } catch (error) {
          this.deps.eventEmitter.emitEvent({
            type: "RISK_REJECTED",
            sessionId: "pending",
            occurredAt: this.now().toISOString(),
            payload: {
              takerId: command.takerId,
              marketId: command.canonicalMarketId,
              reason: error instanceof Error ? error.message : "unknown_risk_error"
            }
          });
          throw error;
        }

        const expiresAt = new Date(this.now().getTime() + command.ttlSeconds * 1000);
        const stateMachine = new RFQStateMachine({
          initialState: "CREATED",
          logger: this.deps.logger
        });

        const session = await withLatencyStage("rfq_create_persistence", {
          endpoint: "POST /rfq",
          canonicalMarketId: command.canonicalMarketId
        }, () => this.deps.sessionRepository.create({
          requestId: this.createRequestId(),
          canonicalMarketId: command.canonicalMarketId,
          takerId: command.takerId,
          side: command.side,
          quantity: command.quantity,
          status: stateMachine.getState(),
          idempotencyKey: command.idempotencyKey,
          expiresAt,
          metadata: {
            source: "post_rfq_endpoint",
            resolution_risk_grouping: resolutionRiskGrouping,
            ...(resolutionRiskShadowGrouping ? { resolution_risk_shadow_grouping: resolutionRiskShadowGrouping } : {}),
            ...(resolutionRiskPolicy
              ? {
                  resolution_risk_policy: {
                    mode: resolutionRiskPolicy.mode,
                    enforcement_active: resolutionRiskPolicy.enforcementActive
                  }
                }
              : {})
          }
        }));

        await this.deps.sessionManager.setSessionMetadata(
          session.id,
          {
            id: session.id,
            state: stateMachine.getState(),
            expiresAt: expiresAt.toISOString(),
            metadata: {
              canonicalMarketId: command.canonicalMarketId,
              takerId: command.takerId,
              resolution_risk_grouping: resolutionRiskGrouping,
              ...(resolutionRiskShadowGrouping ? { resolution_risk_shadow_grouping: resolutionRiskShadowGrouping } : {}),
              ...(resolutionRiskPolicy
                ? {
                    resolution_risk_policy: {
                      mode: resolutionRiskPolicy.mode,
                      enforcement_active: resolutionRiskPolicy.enforcementActive
                    }
                  }
                : {})
            }
          },
          command.ttlSeconds
        );

        const nextState = stateMachine.transitionTo("BROADCAST", {
          reason: "rfq_created",
          metadata: {
            sessionId: session.id
          }
        });
        this.deps.eventEmitter.emitEvent({
          type: "STATE_TRANSITION",
          sessionId: session.id,
          occurredAt: this.now().toISOString(),
          payload: {
            from: "CREATED",
            to: nextState
          }
        });

        await this.deps.sessionRepository.updateStatus(session.id, nextState);
        await this.deps.sessionManager.setSessionMetadata(
          session.id,
          {
            id: session.id,
            state: nextState,
            expiresAt: expiresAt.toISOString(),
            metadata: {
              canonicalMarketId: command.canonicalMarketId,
              takerId: command.takerId,
              resolution_risk_grouping: resolutionRiskGrouping,
              ...(resolutionRiskShadowGrouping ? { resolution_risk_shadow_grouping: resolutionRiskShadowGrouping } : {}),
              ...(resolutionRiskPolicy
                ? {
                    resolution_risk_policy: {
                      mode: resolutionRiskPolicy.mode,
                      enforcement_active: resolutionRiskPolicy.enforcementActive
                    }
                  }
                : {})
            }
          },
          command.ttlSeconds
        );

        const eventPayload = {
          canonicalEventId: market.canonicalEventId,
          canonicalMarketId: command.canonicalMarketId,
          takerId: command.takerId,
          side: command.side,
          quantity: command.quantity,
          resolution_risk_grouping: resolutionRiskGrouping,
          ...(resolutionRiskShadowGrouping ? { resolution_risk_shadow_grouping: resolutionRiskShadowGrouping } : {}),
          ...(resolutionRiskPolicy
            ? {
                resolution_risk_policy: {
                  mode: resolutionRiskPolicy.mode,
                  enforcement_active: resolutionRiskPolicy.enforcementActive
                }
              }
            : {})
        };

        await this.deps.eventRepository.append({
          sessionId: session.id,
          eventType: "RFQ_CREATED",
          eventPayload: eventPayload
        });

        this.deps.eventEmitter.emitEvent({
          type: "RFQ_CREATED",
          sessionId: session.id,
          occurredAt: this.now().toISOString(),
          payload: eventPayload
        });

        rfqCreatedTotal.inc();
        if (resolutionRiskPolicy?.enforcementActive ?? true) {
          recordResolutionGroupingMetrics(resolutionRiskGrouping);
        }
        activeRFQSessions.inc();

        if (this.deps.qualificationHook && this.deps.qualificationConfig?.enabled) {
          const liveDecision = {
            safePools: resolutionRiskGrouping.safePools.map((lane) => [...lane]),
            cautionLanes: resolutionRiskGrouping.cautionLanes.map((lane) => [...lane]),
            blockedProfiles: [...resolutionRiskGrouping.blockedProfiles]
          };
          const shadowGrouping = resolutionRiskShadowGrouping ?? resolutionRiskGrouping;
          const shadowDecision = {
            safePools: shadowGrouping.safePools.map((lane) => [...lane]),
            cautionLanes: shadowGrouping.cautionLanes.map((lane) => [...lane]),
            blockedProfiles: [...shadowGrouping.blockedProfiles]
          };
          await this.deps.qualificationHook.emitEvaluation({
            strategyKey: this.deps.qualificationConfig.strategyKey,
            scopeType: "EVENT",
            scopeId: canonicalEventId,
            decisionType: "RFQ_GROUPING_CHANGE",
            entityId: session.id,
            replayEnvelopeId: replayEnvelope?.id ?? null,
            mode: resolutionRiskShadowGrouping ? "shadow_compare" : "live_only",
            ...(this.deps.qualificationConfig.failMode ? { failMode: this.deps.qualificationConfig.failMode } : {}),
            liveDecision: () => liveDecision,
            shadowDecision: () => shadowDecision,
            metadata: {
              marketId: command.canonicalMarketId,
              canonicalEventId,
              policyMode: resolutionRiskPolicy?.mode ?? "enabled"
            }
          });
        }

        return {
          sessionId: session.id,
          state: "BROADCAST",
          expiresAt: expiresAt.toISOString()
        };
      }
    );
  }
}

const recordResolutionGroupingMetrics = (grouping: ResolutionRiskVenueGrouping): void => {
  for (const _lane of grouping.safePools) {
    rfqResolutionSafePoolTotal.inc();
  }
  for (const _lane of grouping.cautionLanes) {
    rfqResolutionSeparatedTotal.inc();
  }
  for (const _profile of grouping.blockedProfiles) {
    rfqResolutionBlockedTotal.inc();
  }
};
