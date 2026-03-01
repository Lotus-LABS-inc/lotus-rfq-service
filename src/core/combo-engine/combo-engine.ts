import { pino } from "pino";
import crypto from "crypto";
import type { IComboRepository } from "../../repositories/combo.repository.js";
import type { IComboQuoteRepository } from "../../repositories/combo-quote.repository.js";
import type { IComboQuoteNormalizer } from "../../services/combo-quote-normalizer.js";
import type { IExecutionPlanBuilder, ExecutionPlan } from "../execution-plan/execution-plan-builder.js";
import { ComboRFQRequest, ComboRFQSession, ComboQuote, ComboRFQRequestSchema, LPComboQuoteRequest } from "./types.js";
import { RiskEngine } from "../risk-engine.js";
import { computePayoutVector } from "./pricing-engine.js";
import type { RedisClientType } from "redis";
import EventEmitter from "events";
import {
    comboCreatedTotal,
    comboQuoteReceivedTotal,
    comboExecutionSuccessTotal,
    comboExecutionFailureTotal,
    comboPartialFillTotal,
    comboUnwindAttemptsTotal,
    comboRankingDurationMs,
    comboExecutionDurationMs,
    comboPriceComputeMs,
} from "../../observability/metrics.js";
import {
    traceComboCreate,
    traceComboRank,
    traceCombosBuildPlan,
} from "../../observability/combo-tracer.js";

export interface IComboRiskEngine {
    validateRFQCreation(userId: string, marketId: string, worstCaseCost: number): Promise<void>;
    validateBeforeExecution(combo: ComboRFQSession, quote: ComboQuote): Promise<string>;
    updateExposureAfterExecution(token: string, marketId: string, side: string, amount: number): Promise<void>;
    rollbackReservation(token: string): Promise<void>;
}

export interface ICanonicalClient {
    getMarketOutcomeProbabilities(marketIds: string[]): Promise<Map<string, { outcomeProbMap: Map<string, number> }>>;
}

export interface IExecutionRouter {
    executePlan(plan: ExecutionPlan): Promise<{ status: "COMPLETED" | "FAILED", failedLegs?: string[] }>;
}

export interface IComboEngine {
    createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession>;
    collectLPQuote(lpPayload: LPComboQuoteRequest): Promise<void>;
    acceptCombo(sessionId: string, quoteId: string): Promise<ExecutionPlan>;
}

export class ComboEngine implements IComboEngine {
    public events = new EventEmitter();

    public constructor(
        private readonly comboRepo: IComboRepository,
        private readonly quoteRepo: IComboQuoteRepository,
        private readonly normalizer: IComboQuoteNormalizer,
        private readonly planBuilder: IExecutionPlanBuilder,
        private readonly riskEngine: RiskEngine,
        private readonly canonicalClient: ICanonicalClient,
        private readonly executionRouter: IExecutionRouter,
        private readonly redisClient: RedisClientType,
        private readonly logger: pino.Logger
    ) { }

    private async emitSequencedEvent(comboId: string, eventType: string, payload: any): Promise<void> {
        const seqKey = `combo:${comboId}:seq`;
        const seq = await this.redisClient.incr(seqKey);

        // Expiry management for the sequence counter
        if (seq === 1) {
            await this.redisClient.expire(seqKey, 86400); // 24 hours
        }

        const sequencedPayload = {
            combo_id: comboId,
            event_seq: seq,
            ...payload
        };

        this.events.emit(eventType, sequencedPayload);
        this.logger.debug({ comboId, eventType, seq }, "Emitted sequenced WS event");
    }

    public async createComboRFQ(req: ComboRFQRequest): Promise<ComboRFQSession> {
        return traceComboCreate(req.takerId, req.legs.length, req.acceptancePolicy, async (span) => {
            // Validate request schema
            const validated = ComboRFQRequestSchema.parse(req);

            // Map canonical markets
            const marketIds = validated.legs.map((l) => l.canonicalMarketId);
            const probMap = await this.canonicalClient.getMarketOutcomeProbabilities(marketIds);

            // Create standard session object
            const sessionId = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 60_000); // 60s default expiry

            const session: ComboRFQSession = {
                id: sessionId,
                userId: validated.takerId,
                acceptancePolicy: validated.acceptancePolicy,
                state: "OPEN",
                expiresAt,
                metadata: { requestId: validated.requestId },
                createdAt: new Date(),
                legs: validated.legs.map(leg => ({
                    id: crypto.randomUUID(),
                    comboSessionId: sessionId,
                    canonicalMarketId: leg.canonicalMarketId,
                    canonicalOutcomeId: leg.canonicalOutcomeId,
                    side: leg.side,
                    quantity: leg.quantity
                }))
            };

            // Compute theoretical price + worst-case payout for risk validation
            const priceStart = Date.now();
            const { payoffVector, theoreticalPrice } = await computePayoutVector(session, probMap);
            comboPriceComputeMs.observe(Date.now() - priceStart);

            let worstCaseCost = 0;
            for (const payoff of payoffVector) {
                if (payoff < worstCaseCost) worstCaseCost = payoff;
            }

            span.setAttribute("combo.theoretical_price", theoreticalPrice);
            span.setAttribute("combo.worst_case_cost", Math.abs(worstCaseCost));

            // Fast Risk Check (no reservation yet)
            await this.riskEngine.validateRFQCreation(session.userId, marketIds[0], Math.abs(worstCaseCost));

            // Persist
            await this.comboRepo.createSession(session);

            // Initialize Redis keys
            const metaKey = `combo:${sessionId}:meta`;
            await this.redisClient.hSet(metaKey, {
                state: "BROADCAST",
                expiresAt: expiresAt.toISOString(),
                userId: session.userId,
                policy: session.acceptancePolicy
            });
            await this.redisClient.expireAt(metaKey, expiresAt);

            // Emit metric
            comboCreatedTotal.inc({ acceptance_policy: session.acceptancePolicy });

            await this.emitSequencedEvent(sessionId, "COMBO_STATE_UPDATE", { state: session.state, session });
            this.logger.info({ sessionId, takerId: session.userId, theoreticalPrice }, "Combo RFQ Created and Broadcasted");

            return session;
        });
    }

    public async collectLPQuote(lpPayload: LPComboQuoteRequest): Promise<void> {
        const session = await this.comboRepo.getSession(lpPayload.comboSessionId);
        if (!session) throw new Error("Combo Session not found");

        return traceComboRank(session.id, lpPayload.lpId, async (_span) => {
            const rankStart = Date.now();

            // Normalize
            const normalizedQuote = this.normalizer.normalizeLPQuote(lpPayload, session);

            comboRankingDurationMs.observe(Date.now() - rankStart);
            comboQuoteReceivedTotal.inc({
                lp_id: lpPayload.lpId,
                is_combo_quote: String(lpPayload.isComboQuote ?? false)
            });

            // Store in Redis Sorted Set by effectiveCost
            const quotesKey = `combo:${session.id}:quotes`;
            await this.redisClient.zAdd(quotesKey, {
                score: Number(normalizedQuote.effectiveCost),
                value: JSON.stringify(normalizedQuote)
            });
            await this.redisClient.expireAt(quotesKey, session.expiresAt);

            // Persist to Postgres
            await this.quoteRepo.saveQuote(normalizedQuote);

            await this.emitSequencedEvent(session.id, "COMBO_QUOTE_UPDATE", { quote: normalizedQuote });
            this.logger.debug({ quoteId: normalizedQuote.id, comboId: session.id }, "ComboQuote ingested & ranked");
        });
    }

    public async acceptCombo(sessionId: string, quoteId: string): Promise<ExecutionPlan> {
        const session = await this.comboRepo.getSession(sessionId);
        if (!session) throw new Error("Session not found");

        if (session.state !== "OPEN" && session.state !== "ACCEPTED") {
            throw new Error(`Cannot accept combo in state: ${session.state}`);
        }

        if (session.expiresAt < new Date()) {
            await this.comboRepo.updateSessionState(sessionId, "EXPIRED");
            throw new Error("Combo has expired");
        }

        const quotes = await this.quoteRepo.getQuotesForSession(sessionId);
        const selectedQuote = quotes.find((q: any) => q.id === quoteId);
        if (!selectedQuote) throw new Error("Quote not found");

        // Fail-closed: reservation must succeed before any execution
        const reservationToken = await this.riskEngine.validateBeforeExecution(session, selectedQuote);

        return traceCombosBuildPlan(sessionId, reservationToken, session.acceptancePolicy, async (span) => {
            const execStart = Date.now();
            try {
                // Construct Execution Plan
                const plan = await this.planBuilder.buildExecutionPlan(
                    session, selectedQuote, reservationToken, session.acceptancePolicy
                );

                span.setAttribute("combo.plan_id", plan.id);
                span.setAttribute("combo.num_steps", plan.steps.length);

                await this.comboRepo.updateSessionState(sessionId, "EXECUTING" as any);

                // Dispatch
                const result = await this.executionRouter.executePlan(plan);

                comboExecutionDurationMs.observe({ acceptance_policy: session.acceptancePolicy }, Date.now() - execStart);

                if (result.status === "COMPLETED") {
                    await this.comboRepo.updateSessionState(sessionId, "EXECUTED");
                    comboExecutionSuccessTotal.inc({ acceptance_policy: session.acceptancePolicy });

                    for (const leg of session.legs) {
                        await this.riskEngine.updateExposureAfterExecution(
                            reservationToken, leg.canonicalMarketId, leg.side, Number(leg.quantity)
                        );
                    }
                    await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", { status: "SETTLED" });
                } else {
                    await this.comboRepo.updateSessionState(sessionId, "FAILED");
                    comboExecutionFailureTotal.inc({
                        acceptance_policy: session.acceptancePolicy,
                        reason: "execution_failed"
                    });
                    comboUnwindAttemptsTotal.inc({ outcome: "success" }); // Unwind implicit in failure path
                    await this.emitSequencedEvent(sessionId, "COMBO_EXECUTION_UPDATE", { status: "FAILED" });
                }

                return plan;

            } catch (error) {
                comboExecutionDurationMs.observe({ acceptance_policy: session.acceptancePolicy }, Date.now() - execStart);
                comboExecutionFailureTotal.inc({
                    acceptance_policy: session.acceptancePolicy,
                    reason: "exception"
                });

                this.logger.error({ sessionId, error: (error as Error).message }, "Execution Failed");
                await this.comboRepo.updateSessionState(sessionId, "FAILED");

                // Rollback the reservation to free collateral locks
                await this.riskEngine.rollbackReservation(reservationToken).catch((e: any) => {
                    comboUnwindAttemptsTotal.inc({ outcome: "failed" });
                    this.logger.error({ sessionId, token: reservationToken, err: e }, "Failed to rollback risk reservation");
                });
                throw error;
            }
        });
    }
}
