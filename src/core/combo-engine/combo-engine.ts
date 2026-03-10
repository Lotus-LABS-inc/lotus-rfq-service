import type { Logger } from "pino";
import crypto from "crypto";
import EventEmitter from "events";
import type { IComboRepository } from "../../repositories/combo.repository.js";
import type { IComboQuoteRepository } from "../../repositories/combo-quote.repository.js";
import type { IComboQuoteNormalizer } from "../../services/combo-quote-normalizer.js";
import type { IExecutionPlanBuilder, ExecutionPlan } from "../execution-plan/execution-plan-builder.js";
import type { IMultiLegInternalNettingEngine } from "./multi-leg-internal-netting-engine.js";
import {
  ComboRFQRequest,
  ComboAcceptResult,
  ComboRFQSession,
  ComboQuote,
  ComboRFQRequestSchema,
  LPComboQuoteRequest,
  type MultiLegInternalNettingInput,
  type ResidualComboLeg
} from "./types.js";
import { computePayoutVector } from "./pricing-engine.js";
import {
  comboCreatedTotal,
  comboInternalNetEnabledState,
  comboInternalNetAttemptTotal,
  comboInternalNetKillSwitchTotal,
  comboInternalNetPartialTotal,
  comboInternalNetResidualRoutedTotal,
  comboInternalNetShadowDivergenceTotal,
  comboInternalNetShadowMatchTotal,
  comboInternalNetShadowNettedSize,
  comboInternalNetShadowTotal,
  comboInternalNetSuccessTotal,
  comboQuoteReceivedTotal,
  comboExecutionSuccessTotal,
  comboExecutionFailureTotal,
  comboUnwindAttemptsTotal,
  comboRankingDurationMs,
  comboExecutionDurationMs,
  comboPriceComputeMs
} from "../../observability/metrics.js";
import {
  withSpan,
  traceComboCreate,
  traceComboRank,
  traceCombosBuildPlan
} from "../../observability/combo-tracer.js";
import { LiquiditySource } from "../sor/types.js";
import {
  compareInternalNettingShadowDecision,
  isInternalNettingKillSwitchActive,
  isInternalNettingRolloutWindowActive,
  isInternalNettingSampled,
  type InternalNettingPreviewOutcome,
  type InternalNettingShadowDecision,
  type InternalNettingShadowReason
} from "./runtime-controls.js";

export interface IComboRiskEngine {
  validateRFQCreation(rfq: {
    taker_id: string;
    canonical_market_id: string;
    side: "buy" | "sell";
    quantity: string;
  }): Promise<void>;
  validateBeforeExecution(combo: ComboRFQSession, quote: ComboQuote): Promise<string>;
  updateExposureAfterExecution(token: string, marketId: string, side: string, amount: number): Promise<void>;
  rollbackReservation?(token: string): Promise<void>;
}

export interface ICanonicalClient {
  getMarketOutcomeProbabilities(
    marketIds: string[]
  ): Promise<Map<string, { outcomeProbMap: Map<string, number> }>>;
}

export interface IExecutionRouter {
  executePlan(plan: ExecutionPlan): Promise<{ status: "COMPLETED" | "FAILED"; failedLegs?: string[] }>;
}

export interface ComboRedisClient {
  incr(key: string): Promise<number>;
  get?(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number>;
  hset(key: string, ...args: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expireat(key: string, unixTime: number): Promise<number>;
}

export interface IComboEngine {
  createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession>;
  collectLPQuote(lpPayload: LPComboQuoteRequest): Promise<void>;
  acceptCombo(sessionId: string, quoteId: string): Promise<ComboAcceptResult>;
}

export interface ComboEngineRolloutConfig {
  internalNettingEnabled?: boolean;
  internalNettingShadowEnabled?: boolean;
  internalNettingShadowPercent?: number;
  internalNettingShadowStartAt?: string;
  internalNettingShadowEndAt?: string;
  internalNettingCanaryEnabled?: boolean;
  internalNettingCanaryPercent?: number;
  internalNettingCanaryStartAt?: string;
  internalNettingCanaryEndAt?: string;
  now?: () => Date;
}

export class ComboEngine implements IComboEngine {
  public readonly events = new EventEmitter();

  public constructor(
    private readonly comboRepo: IComboRepository,
    private readonly quoteRepo: IComboQuoteRepository,
    private readonly normalizer: IComboQuoteNormalizer,
    private readonly planBuilder: IExecutionPlanBuilder,
    private readonly multiLegInternalNettingEngine: IMultiLegInternalNettingEngine,
    private readonly riskEngine: IComboRiskEngine,
    private readonly canonicalClient: ICanonicalClient,
    private readonly executionRouter: IExecutionRouter,
    private readonly redisClient: ComboRedisClient,
    private readonly logger: Logger,
    private readonly rolloutConfig: ComboEngineRolloutConfig = {}
  ) {
    comboInternalNetEnabledState.set(
      this.rolloutConfig.internalNettingEnabled || this.rolloutConfig.internalNettingCanaryEnabled ? 1 : 0
    );
  }

  private async emitSequencedEvent(
    comboId: string,
    eventType: "COMBO_STATE_UPDATE" | "COMBO_QUOTE_UPDATE" | "COMBO_EXECUTION_UPDATE",
    payload: Record<string, unknown>
  ): Promise<void> {
    const seqKey = `combo:${comboId}:seq`;
    const seq = await this.redisClient.incr(seqKey);

    if (seq === 1) {
      await this.redisClient.expire(seqKey, 86400);
    }

    this.events.emit(eventType, {
      combo_id: comboId,
      event_seq: seq,
      ...payload
    });

    this.logger.debug({ comboId, eventType, seq }, "Emitted sequenced combo event.");
  }

  public async createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession> {
    return traceComboCreate(req.takerId, req.legs.length, req.acceptancePolicy, async (span) => {
      const validated = ComboRFQRequestSchema.parse(req);
      const marketIds = validated.legs.map((leg) => leg.canonicalMarketId);
      const probMap = await this.canonicalClient.getMarketOutcomeProbabilities(marketIds);

      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60000);

      const session: ComboRFQSession = {
        id: sessionId,
        userId: validated.takerId,
        acceptancePolicy: validated.acceptancePolicy,
        state: "OPEN",
        expiresAt,
        metadata: { requestId: validated.requestId },
        createdAt: new Date(),
        legs: validated.legs.map((leg) => ({
          id: crypto.randomUUID(),
          comboSessionId: sessionId,
          canonicalMarketId: leg.canonicalMarketId,
          canonicalOutcomeId: leg.canonicalOutcomeId,
          side: leg.side,
          quantity: leg.quantity
        }))
      };

      const priceStart = Date.now();
      const { payoffVector, theoreticalPrice } = await computePayoutVector(session, probMap);
      comboPriceComputeMs.observe(Date.now() - priceStart);

      let worstCaseCost = 0;
      for (const payoff of payoffVector) {
        if (payoff < worstCaseCost) {
          worstCaseCost = payoff;
        }
      }

      span.setAttribute("combo.theoretical_price", theoreticalPrice);
      span.setAttribute("combo.worst_case_cost", Math.abs(worstCaseCost));

      await this.riskEngine.validateRFQCreation({
        taker_id: session.userId,
        canonical_market_id: marketIds[0] ?? session.legs[0]?.canonicalMarketId ?? "",
        side: session.legs[0]?.side ?? "buy",
        quantity: Math.abs(worstCaseCost).toString()
      });

      await this.comboRepo.createSession(session);

      const metaKey = `combo:${sessionId}:meta`;
      await this.redisClient.hset(
        metaKey,
        "state",
        "OPEN",
        "expiresAt",
        expiresAt.toISOString(),
        "userId",
        session.userId,
        "policy",
        String(session.acceptancePolicy)
      );
      await this.redisClient.expireat(metaKey, Math.floor(expiresAt.getTime() / 1000));

      comboCreatedTotal.inc({ acceptance_policy: session.acceptancePolicy });
      await this.emitSequencedEvent(sessionId, "COMBO_STATE_UPDATE", { state: session.state, sessionId });

      this.logger.info(
        { sessionId, takerId: session.userId, theoreticalPrice },
        "Combo RFQ created and broadcasted."
      );

      return session;
    });
  }

  public async collectLPQuote(lpPayload: LPComboQuoteRequest): Promise<void> {
    const session = await this.comboRepo.getSession(lpPayload.comboSessionId);
    if (!session) {
      throw new Error("Combo Session not found");
    }

    return traceComboRank(session.id, lpPayload.lpId, async () => {
      const rankStart = Date.now();
      const normalizedQuote = this.normalizer.normalizeLPQuote(lpPayload, session);

      comboRankingDurationMs.observe(Date.now() - rankStart);
      comboQuoteReceivedTotal.inc({
        lp_id: lpPayload.lpId,
        is_combo_quote: String(lpPayload.isComboQuote ?? false)
      });

      const quotesKey = `combo:${session.id}:quotes`;
      await this.redisClient.zadd(
        quotesKey,
        Number(normalizedQuote.effectiveCost),
        JSON.stringify(normalizedQuote)
      );
      await this.redisClient.expireat(quotesKey, Math.floor(session.expiresAt.getTime() / 1000));

      await this.quoteRepo.saveQuote(normalizedQuote);
      await this.emitSequencedEvent(session.id, "COMBO_QUOTE_UPDATE", { quoteId: normalizedQuote.id });

      this.logger.debug({ quoteId: normalizedQuote.id, comboId: session.id }, "Combo quote ingested and ranked.");
    });
  }

  public async acceptCombo(sessionId: string, quoteId: string): Promise<ComboAcceptResult> {
    const session = await this.comboRepo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.state !== "OPEN" && session.state !== "ACCEPTED") {
      throw new Error(`Cannot accept combo in state: ${session.state}`);
    }

    if (session.expiresAt < new Date()) {
      await this.comboRepo.updateSessionState(sessionId, "EXPIRED");
      throw new Error("Combo has expired");
    }

    const quotes = await this.quoteRepo.getQuotesForSession(sessionId);
    const selectedQuote = quotes.find((quote) => quote.id === quoteId);
    if (!selectedQuote) {
      throw new Error("Quote not found");
    }

    const reservationToken = await this.riskEngine.validateBeforeExecution(session, selectedQuote);

    return traceCombosBuildPlan(sessionId, reservationToken, session.acceptancePolicy, async (span) => {
      const execStart = Date.now();
      try {
        const internalNetKillSwitchActive =
          typeof this.redisClient.get === "function"
            ? await isInternalNettingKillSwitchActive(this.redisClient as Required<Pick<ComboRedisClient, "get">>)
            : false;
        const rolloutMode = this.resolveInternalNettingMode(session.id, internalNetKillSwitchActive);

        span.setAttribute("combo.internal_net.kill_switch_active", internalNetKillSwitchActive);
        span.setAttribute("combo.internal_net.mode", rolloutMode.mode);
        span.setAttribute("combo.internal_net.shadow_sampled", rolloutMode.shadowSampled);
        span.setAttribute("combo.internal_net.canary_sampled", rolloutMode.canarySampled);

        if (rolloutMode.shadowSampled) {
          try {
            await this.runInternalNetShadowComparison(session, internalNetKillSwitchActive, rolloutMode.mode);
          } catch (error) {
            comboInternalNetShadowDivergenceTotal.inc({ reason: "error" });
            this.logger.error({ comboId: session.id, err: error }, "Combo internal-net shadow comparison failed.");
          }
        }

        const nettingResult = rolloutMode.authoritativeInternalNetting
          ? await this.runAuthoritativeInternalNet(session, internalNetKillSwitchActive)
          : this.zeroNettingResult(session);

        const refreshedSession = await this.comboRepo.getSession(sessionId);
        if (!refreshedSession) {
          throw new Error("Session disappeared after internal netting.");
        }

        if (!nettingResult.residualRemaining) {
          await this.comboRepo.updateSessionState(sessionId, "EXECUTED");
          comboInternalNetSuccessTotal.inc();
          comboExecutionSuccessTotal.inc({ acceptance_policy: session.acceptancePolicy });
          comboExecutionDurationMs.observe({ acceptance_policy: session.acceptancePolicy }, Date.now() - execStart);

          if (this.riskEngine.rollbackReservation) {
            await this.riskEngine.rollbackReservation(reservationToken);
          }

          await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", {
            status: "SETTLED",
            liquiditySource: LiquiditySource.INTERNAL_NETTING,
            nettedSize: nettingResult.nettedSize,
            nettingGroupIds: nettingResult.nettingGroupIds
          });

          return {
            kind: "internal_filled",
            comboId: sessionId,
            nettingGroupIds: nettingResult.nettingGroupIds,
            nettedSize: nettingResult.nettedSize
          };
        }

        const residualSession = this.applyResidualLegsToSession(refreshedSession, nettingResult.residualLegs);
        if (Number(nettingResult.nettedSize) > 0) {
          comboInternalNetPartialTotal.inc();
        }

        const plan = await this.planBuilder.buildExecutionPlan(
          residualSession,
          selectedQuote,
          reservationToken,
          residualSession.acceptancePolicy
        );

        span.setAttribute("combo.plan_id", plan.id);
        span.setAttribute("combo.num_steps", plan.steps.length);
        span.setAttribute("combo.internal_netted_size", nettingResult.nettedSize);
        span.setAttribute("combo.residual_leg_count", nettingResult.residualLegs.length);

        await this.comboRepo.updateSessionState(sessionId, "ACCEPTED");
        if (Number(nettingResult.nettedSize) > 0) {
          comboInternalNetResidualRoutedTotal.inc();
        }
        const result = await this.executionRouter.executePlan(plan);

        comboExecutionDurationMs.observe({ acceptance_policy: residualSession.acceptancePolicy }, Date.now() - execStart);

        if (result.status === "COMPLETED") {
          await this.comboRepo.updateSessionState(sessionId, "EXECUTED");
          comboExecutionSuccessTotal.inc({ acceptance_policy: residualSession.acceptancePolicy });

          for (const leg of residualSession.legs.filter((candidate) => Number(candidate.remainingSize ?? candidate.quantity) > 0)) {
            await this.riskEngine.updateExposureAfterExecution(
              reservationToken,
              leg.canonicalMarketId,
              leg.side,
              Number(leg.remainingSize ?? leg.quantity)
            );
          }

          await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", {
            status: "SETTLED",
            liquiditySource: Number(nettingResult.nettedSize) > 0 ? LiquiditySource.INTERNAL_NETTING : LiquiditySource.LP,
            nettedSize: nettingResult.nettedSize,
            residualLegCount: nettingResult.residualLegs.length
          });
          return {
            kind: "external_plan",
            plan,
            nettedSize: nettingResult.nettedSize,
            residualLegCount: nettingResult.residualLegs.length
          };
        }

        await this.comboRepo.updateSessionState(sessionId, "FAILED");
        comboExecutionFailureTotal.inc({
          acceptance_policy: residualSession.acceptancePolicy,
          reason: "execution_failed"
        });
        comboUnwindAttemptsTotal.inc({ outcome: "success" });
        await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", {
          status: "FAILED",
          liquiditySource: Number(nettingResult.nettedSize) > 0 ? LiquiditySource.INTERNAL_NETTING : LiquiditySource.LP,
          nettedSize: nettingResult.nettedSize,
          residualLegCount: nettingResult.residualLegs.length
        });
        return {
          kind: "external_plan",
          plan,
          nettedSize: nettingResult.nettedSize,
          residualLegCount: nettingResult.residualLegs.length
        };
      } catch (error) {
        comboExecutionDurationMs.observe({ acceptance_policy: session.acceptancePolicy }, Date.now() - execStart);
        comboExecutionFailureTotal.inc({
          acceptance_policy: session.acceptancePolicy,
          reason: "exception"
        });

        this.logger.error({ sessionId, err: error }, "Combo execution failed.");
        await this.comboRepo.updateSessionState(sessionId, "FAILED");

        if (this.riskEngine.rollbackReservation) {
          await this.riskEngine.rollbackReservation(reservationToken).catch((rollbackError: unknown) => {
            comboUnwindAttemptsTotal.inc({ outcome: "failed" });
            this.logger.error(
              { sessionId, token: reservationToken, err: rollbackError },
              "Failed to rollback risk reservation."
            );
          });
        }

        throw error;
      }
    });
  }

  private toInternalNettingInput(session: ComboRFQSession): MultiLegInternalNettingInput {
    return {
      id: session.id,
      userId: session.userId,
      state: session.state,
      legs: session.legs.map((leg) => ({
        id: leg.id,
        canonicalMarketId: leg.canonicalMarketId,
        canonicalOutcomeId: leg.canonicalOutcomeId,
        side: leg.side,
        remainingSize: leg.remainingSize ?? leg.quantity,
        ...(leg.priceHint ? { priceHint: leg.priceHint } : {})
      }))
    };
  }

  private resolveInternalNettingMode(
    stableId: string,
    killSwitchActive: boolean
  ): {
    mode: "disabled" | "shadow" | "canary" | "enabled";
    authoritativeInternalNetting: boolean;
    shadowSampled: boolean;
    canarySampled: boolean;
  } {
    const now = this.rolloutConfig.now;
    const shadowWindowActive = isInternalNettingRolloutWindowActive({
      enabled: this.rolloutConfig.internalNettingShadowEnabled ?? false,
      percent: this.rolloutConfig.internalNettingShadowPercent ?? 0,
      ...(this.rolloutConfig.internalNettingShadowStartAt ? { startAt: this.rolloutConfig.internalNettingShadowStartAt } : {}),
      ...(this.rolloutConfig.internalNettingShadowEndAt ? { endAt: this.rolloutConfig.internalNettingShadowEndAt } : {}),
      ...(now ? { now } : {})
    });
    const canaryWindowActive = isInternalNettingRolloutWindowActive({
      enabled: this.rolloutConfig.internalNettingCanaryEnabled ?? false,
      percent: this.rolloutConfig.internalNettingCanaryPercent ?? 0,
      ...(this.rolloutConfig.internalNettingCanaryStartAt ? { startAt: this.rolloutConfig.internalNettingCanaryStartAt } : {}),
      ...(this.rolloutConfig.internalNettingCanaryEndAt ? { endAt: this.rolloutConfig.internalNettingCanaryEndAt } : {}),
      ...(now ? { now } : {})
    });

    const shadowSampled =
      shadowWindowActive &&
      isInternalNettingSampled(stableId, this.rolloutConfig.internalNettingShadowPercent ?? 0);
    const canarySampled =
      canaryWindowActive &&
      isInternalNettingSampled(stableId, this.rolloutConfig.internalNettingCanaryPercent ?? 0);

    const authoritativeInternalNetting =
      !killSwitchActive && ((this.rolloutConfig.internalNettingEnabled ?? false) || canarySampled);

    if (authoritativeInternalNetting && canarySampled) {
      return { mode: "canary", authoritativeInternalNetting: true, shadowSampled, canarySampled };
    }
    if (authoritativeInternalNetting) {
      return { mode: "enabled", authoritativeInternalNetting: true, shadowSampled, canarySampled };
    }
    if (shadowSampled) {
      return { mode: "shadow", authoritativeInternalNetting: false, shadowSampled, canarySampled };
    }
    return { mode: "disabled", authoritativeInternalNetting: false, shadowSampled, canarySampled };
  }

  private async runAuthoritativeInternalNet(
    session: ComboRFQSession,
    killSwitchActive: boolean
  ): Promise<Awaited<ReturnType<IMultiLegInternalNettingEngine["attemptNet"]>>> {
    if (killSwitchActive) {
      comboInternalNetKillSwitchTotal.inc({ mode: "authoritative" });
      this.logger.warn({ comboId: session.id }, "Skipped combo internal netting because kill switch is active.");
      return this.zeroNettingResult(session);
    }

    return withSpan(
      "combo.internal_net",
      {
        "combo.id": session.id,
        "combo.acceptance_policy": session.acceptancePolicy,
        "combo.internal_net.kill_switch_active": false,
        "liquidity_source": LiquiditySource.INTERNAL_NETTING
      },
      async (netSpan) => {
        comboInternalNetAttemptTotal.inc();
        const result = await this.multiLegInternalNettingEngine.attemptNet(this.toInternalNettingInput(session));
        netSpan.setAttribute("internal_netted_size", result.nettedSize);
        netSpan.setAttribute("residual_leg_count", result.residualLegs.length);
        netSpan.setAttribute("liquidity_source", LiquiditySource.INTERNAL_NETTING);
        return result;
      }
    );
  }

  private async runInternalNetShadowComparison(
    session: ComboRFQSession,
    killSwitchActive: boolean,
    mode: "disabled" | "shadow" | "canary" | "enabled"
  ): Promise<void> {
    const sampled = true;
    comboInternalNetShadowTotal.inc({ mode, sampled: String(sampled) });

    const authoritative = this.buildAuthoritativeExternalDecision(session);
    let reason: InternalNettingShadowReason | undefined;

    const shadowDecision = await withSpan(
      "combo.internal_net.shadow_evaluate",
      {
        "combo.id": session.id,
        "combo.acceptance_policy": session.acceptancePolicy,
        "combo.internal_net.kill_switch_active": killSwitchActive,
        "shadow_mode": true
      },
      async () => {
        if (killSwitchActive) {
          reason = "kill_switch";
          return this.buildShadowDecision(this.zeroNettingResult(session));
        }

        const result = await this.multiLegInternalNettingEngine.previewNet(this.toInternalNettingInput(session));
        comboInternalNetShadowNettedSize.observe(Number(result.nettedSize));
        return this.buildShadowDecision(result);
      }
    );

    await withSpan(
      "combo.internal_net.shadow_compare",
      {
        "combo.id": session.id,
        "combo.acceptance_policy": session.acceptancePolicy,
        "combo.internal_net.kill_switch_active": killSwitchActive,
        "shadow_mode": true
      },
      async (compareSpan) => {
        const comparison =
          reason === "kill_switch" || reason === "disabled"
            ? {
              match: false,
              dimension: "netted_outcome" as const,
              reason
            }
            : compareInternalNettingShadowDecision(authoritative, shadowDecision);

        compareSpan.setAttribute("combo.internal_net.shadow.match", comparison.match);
        compareSpan.setAttribute("combo.internal_net.shadow.dimension", comparison.dimension);
        if (comparison.reason) {
          compareSpan.setAttribute("combo.internal_net.shadow.reason", comparison.reason);
        }

        if (comparison.match) {
          comboInternalNetShadowMatchTotal.inc({ dimension: comparison.dimension });
          return;
        }

        comboInternalNetShadowDivergenceTotal.inc({
          reason: comparison.reason ?? "error"
        });
      }
    );
  }

  private buildAuthoritativeExternalDecision(session: ComboRFQSession): InternalNettingShadowDecision {
    return {
      outcome: "no_net",
      residualLegCount: session.legs.length,
      nettedSize: 0
    };
  }

  private buildShadowDecision(
    result: Awaited<ReturnType<IMultiLegInternalNettingEngine["attemptNet"]>>
  ): InternalNettingShadowDecision {
    return {
      outcome: this.toPreviewOutcome(result),
      residualLegCount: result.residualLegs.length,
      nettedSize: Number(result.nettedSize)
    };
  }

  private toPreviewOutcome(
    result: Awaited<ReturnType<IMultiLegInternalNettingEngine["attemptNet"]>>
  ): InternalNettingPreviewOutcome {
    if (Number(result.nettedSize) <= 0) {
      return "no_net";
    }
    return result.residualRemaining ? "partial_net" : "full_net";
  }

  private zeroNettingResult(
    session: ComboRFQSession
  ): Awaited<ReturnType<IMultiLegInternalNettingEngine["attemptNet"]>> {
    return {
      nettedSize: "0",
      residualLegs: this.toInternalNettingInput(session).legs,
      residualRemaining: true,
      nettingGroupIds: [],
      eventsWritten: 0
    };
  }

  private applyResidualLegsToSession(
    session: ComboRFQSession,
    residualLegs: readonly ResidualComboLeg[]
  ): ComboRFQSession {
    const residualByLegId = new Map(residualLegs.map((leg) => [leg.id, leg] as const));

    return {
      ...session,
      legs: session.legs
        .map((leg) => {
          const residual = residualByLegId.get(leg.id);
          const remainingSize = residual?.remainingSize ?? "0";
          return {
            ...leg,
            remainingSize,
            ...(residual?.priceHint ? { priceHint: residual.priceHint } : leg.priceHint ? { priceHint: leg.priceHint } : {})
          };
        })
        .filter((leg) => Number(leg.remainingSize ?? leg.quantity) > 0)
    };
  }
}
