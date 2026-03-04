import type { Logger } from "pino";
import crypto from "crypto";
import EventEmitter from "events";
import type { IComboRepository } from "../../repositories/combo.repository.js";
import type { IComboQuoteRepository } from "../../repositories/combo-quote.repository.js";
import type { IComboQuoteNormalizer } from "../../services/combo-quote-normalizer.js";
import type { IExecutionPlanBuilder, ExecutionPlan } from "../execution-plan/execution-plan-builder.js";
import {
  ComboRFQRequest,
  ComboRFQSession,
  ComboQuote,
  ComboRFQRequestSchema,
  LPComboQuoteRequest
} from "./types.js";
import { computePayoutVector } from "./pricing-engine.js";
import {
  comboCreatedTotal,
  comboQuoteReceivedTotal,
  comboExecutionSuccessTotal,
  comboExecutionFailureTotal,
  comboUnwindAttemptsTotal,
  comboRankingDurationMs,
  comboExecutionDurationMs,
  comboPriceComputeMs
} from "../../observability/metrics.js";
import {
  traceComboCreate,
  traceComboRank,
  traceCombosBuildPlan
} from "../../observability/combo-tracer.js";

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
  expire(key: string, seconds: number): Promise<number>;
  hset(key: string, ...args: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  expireat(key: string, unixTime: number): Promise<number>;
}

export interface IComboEngine {
  createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession>;
  collectLPQuote(lpPayload: LPComboQuoteRequest): Promise<void>;
  acceptCombo(sessionId: string, quoteId: string): Promise<ExecutionPlan>;
}

export class ComboEngine implements IComboEngine {
  public readonly events = new EventEmitter();

  public constructor(
    private readonly comboRepo: IComboRepository,
    private readonly quoteRepo: IComboQuoteRepository,
    private readonly normalizer: IComboQuoteNormalizer,
    private readonly planBuilder: IExecutionPlanBuilder,
    private readonly riskEngine: IComboRiskEngine,
    private readonly canonicalClient: ICanonicalClient,
    private readonly executionRouter: IExecutionRouter,
    private readonly redisClient: ComboRedisClient,
    private readonly logger: Logger
  ) {}

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

  public async acceptCombo(sessionId: string, quoteId: string): Promise<ExecutionPlan> {
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
        const plan = await this.planBuilder.buildExecutionPlan(
          session,
          selectedQuote,
          reservationToken,
          session.acceptancePolicy
        );

        span.setAttribute("combo.plan_id", plan.id);
        span.setAttribute("combo.num_steps", plan.steps.length);

        await this.comboRepo.updateSessionState(sessionId, "ACCEPTED");
        const result = await this.executionRouter.executePlan(plan);

        comboExecutionDurationMs.observe({ acceptance_policy: session.acceptancePolicy }, Date.now() - execStart);

        if (result.status === "COMPLETED") {
          await this.comboRepo.updateSessionState(sessionId, "EXECUTED");
          comboExecutionSuccessTotal.inc({ acceptance_policy: session.acceptancePolicy });

          for (const leg of session.legs) {
            await this.riskEngine.updateExposureAfterExecution(
              reservationToken,
              leg.canonicalMarketId,
              leg.side,
              Number(leg.quantity)
            );
          }

          await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", { status: "SETTLED" });
          return plan;
        }

        await this.comboRepo.updateSessionState(sessionId, "FAILED");
        comboExecutionFailureTotal.inc({
          acceptance_policy: session.acceptancePolicy,
          reason: "execution_failed"
        });
        comboUnwindAttemptsTotal.inc({ outcome: "success" });
        await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", { status: "FAILED" });
        return plan;
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
}
