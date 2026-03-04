import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { RFQEventEmitter } from "../rfq-engine/rfq-domain-events.js";
import type { RankedQuote } from "../ranking/quote-ranking.js";
import {
  QuoteStaleError,
  QuoteStalenessGuard,
  type StalenessAwareQuote
} from "../quote-staleness-guard.js";
import {
  RFQ_STATES,
  RFQStateMachine,
  type RFQState
} from "../rfq-engine/rfq-state-machine.js";
import { RFQExecutionRepository } from "../../db/repositories/rfq-execution-repository.js";
import { RFQQuoteRepository } from "../../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../rfq-engine/rfq-session-manager.js";
import {
  executionFailureTotal,
  executionLatencyMs,
  executionSuccessTotal,
  lockWaitTimeMs
} from "../../observability/metrics.js";
import { withSpan } from "../../observability/tracing.js";
import type { LPStatsRepository } from "../../repositories/lp-stats.repository.js";
import type { IRiskEngine, ReservationToken } from "../risk-engine.js";

export interface ExecutionGatewayRequest {
  sessionId: string;
  quoteId: string;
  price: string;
  quantity: string;
}

export interface ExecutionGatewaySuccessResult {
  ok: true;
  venueExecutionRef?: string;
  transactionHash?: string;
  executionPayload?: Readonly<Record<string, unknown>>;
}

export interface ExecutionGatewayFailureResult {
  ok: false;
  reason: string;
  executionPayload?: Readonly<Record<string, unknown>>;
}

export type ExecutionGatewayResult = ExecutionGatewaySuccessResult | ExecutionGatewayFailureResult;

export interface ExecutionGateway {
  execute(request: ExecutionGatewayRequest): Promise<ExecutionGatewayResult>;
}

export interface ExecuteRFQCommand {
  sessionId: string;
  rankedQuotes: readonly RankedQuote[];
  fallbackToNextQuote: boolean;
  reservationToken?: ReservationToken;
}

export interface ExecutionAttemptResult {
  quoteId: string;
  status: "SUCCESS" | "FAILED";
  reason?: string;
}

export interface ExecuteRFQResult {
  ok: boolean;
  executedQuoteId?: string;
  attempts: ExecutionAttemptResult[];
}

export interface ExecutionRouterDependencies {
  sessionRepository: RFQSessionRepository;
  quoteRepository: RFQQuoteRepository;
  executionRepository: RFQExecutionRepository;
  sessionManager: RFQSessionManager;
  executionGateway: ExecutionGateway;
  eventEmitter: RFQEventEmitter;
  logger: Pick<Logger, "warn" | "error">;
  lpStatsRepository?: LPStatsRepository;
  now?: () => Date;
  lockOwnerFactory?: () => string;
  lockTtlMs?: number;
  riskEngine: IRiskEngine;
}

export class RFQLockError extends Error {
  public constructor(sessionId: string) {
    super(`Unable to acquire RFQ lock for session ${sessionId}.`);
    this.name = "RFQLockError";
  }
}

export class RFQSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`RFQ session ${sessionId} not found.`);
    this.name = "RFQSessionNotFoundError";
  }
}

export class NoValidQuotesError extends Error {
  public constructor(sessionId: string) {
    super(`No valid quotes remain for session ${sessionId}.`);
    this.name = "NoValidQuotesError";
  }
}

export class ExecutionRouterService {
  private readonly now: () => Date;
  private readonly lockOwnerFactory: () => string;
  private readonly lockTtlMs: number;
  private readonly stalenessGuard: QuoteStalenessGuard;

  public constructor(private readonly deps: ExecutionRouterDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.lockOwnerFactory = deps.lockOwnerFactory ?? (() => randomUUID());
    this.lockTtlMs = deps.lockTtlMs ?? 10000;
    this.stalenessGuard = new QuoteStalenessGuard(this.now);
  }

  public async execute(command: ExecuteRFQCommand): Promise<ExecuteRFQResult> {
    return withSpan(
      "rfq.execution",
      {
        rfq_id: command.sessionId,
        lp_id: "n/a",
        state: "EXECUTING"
      },
      async () => {
        const session = await this.deps.sessionRepository.findById(command.sessionId);
        if (!session) {
          throw new RFQSessionNotFoundError(command.sessionId);
        }

        const lockOwner = this.lockOwnerFactory();
        const lockWaitStart = performance.now();
        const lockAcquired = await withSpan(
          "rfq.redis_lock_acquisition",
          {
            rfq_id: command.sessionId,
            lp_id: "n/a",
            state: "LOCKING"
          },
          async () =>
            this.deps.sessionManager.acquireLock(command.sessionId, lockOwner, this.lockTtlMs)
        );
        lockWaitTimeMs.observe(performance.now() - lockWaitStart);

        if (!lockAcquired) {
          throw new RFQLockError(command.sessionId);
        }

        const attempts: ExecutionAttemptResult[] = [];

        try {
          // Transition to EXECUTING before starting quote iteration
          await this.transitionSessionToState(command.sessionId, session.status, "EXECUTING");

          let sawStaleQuote = false;

          for (const rankedQuote of command.rankedQuotes) {
            const quoteRecord = await this.deps.quoteRepository.findByExternalQuoteId(
              command.sessionId,
              rankedQuote.quoteId
            );

            if (!quoteRecord) {
              attempts.push({
                quoteId: rankedQuote.quoteId,
                status: "FAILED",
                reason: "QUOTE_NOT_FOUND"
              });
              executionFailureTotal.inc();

              if (!command.fallbackToNextQuote) {
                break;
              }
              continue;
            }

            const stalenessQuoteBase: StalenessAwareQuote = {
              expires_at: quoteRecord.valid_until.toISOString(),
              soft_refresh_flag: rankedQuote.soft_refresh_flag
            };
            const stalenessQuote: StalenessAwareQuote =
              typeof rankedQuote.firm_until === "string"
                ? { ...stalenessQuoteBase, firm_until: rankedQuote.firm_until }
                : stalenessQuoteBase;

            try {
              this.stalenessGuard.validateBeforeExecution(stalenessQuote);
            } catch (error) {
              if (!(error instanceof QuoteStaleError)) {
                throw error;
              }
              const lpId = this.extractLpId(rankedQuote, quoteRecord.quote_payload);

              await this.persistExecutionFailure({
                sessionId: command.sessionId,
                quoteRecordId: quoteRecord.id,
                ...(lpId ? { lpId } : {}),
                quoteId: rankedQuote.quoteId,
                price: quoteRecord.price,
                quantity: quoteRecord.quantity,
                reason: error.reason,
                payload: {}
              });

              attempts.push({
                quoteId: rankedQuote.quoteId,
                status: "FAILED",
                reason: error.reason
              });
              sawStaleQuote = true;

              if (!command.fallbackToNextQuote) {
                break;
              }
              continue;
            }

            const executionStartedAt = performance.now();
            const gatewayResult = await this.deps.executionGateway.execute({
              sessionId: command.sessionId,
              quoteId: rankedQuote.quoteId,
              price: quoteRecord.price,
              quantity: quoteRecord.quantity
            });
            executionLatencyMs.observe(performance.now() - executionStartedAt);

            if (gatewayResult.ok) {
              attempts.push({
                quoteId: rankedQuote.quoteId,
                status: "SUCCESS"
              });

              // Update exposure after successful execution
              const executionRecord = await this.deps.executionRepository.create({
                sessionId: command.sessionId,
                quoteId: quoteRecord.id,
                executionStatus: "SUCCESS",
                executedPrice: quoteRecord.price,
                executedQuantity: quoteRecord.quantity,
                ...(gatewayResult.venueExecutionRef
                  ? { venueExecutionRef: gatewayResult.venueExecutionRef }
                  : {}),
                ...(gatewayResult.transactionHash
                  ? { transactionHash: gatewayResult.transactionHash }
                  : {}),
                executionPayload: {
                  quoteId: rankedQuote.quoteId,
                  ...(gatewayResult.executionPayload ?? {})
                }
              });

              try {
                await this.deps.riskEngine.updateExposureAfterExecution({
                  id: executionRecord.id,
                  sessionId: command.sessionId,
                  takerId: session.taker_id,
                  canonicalMarketId: session.canonical_market_id,
                  side: session.side,
                  executedQuantity: executionRecord.executed_quantity,
                  executedPrice: executionRecord.executed_price
                });
              } catch (error) {
                this.deps.logger.error({ err: error, executionId: executionRecord.id }, "Failed to update exposure after execution success.");
              }

              this.deps.eventEmitter.emitEvent({
                type: "EXECUTION_UPDATE",
                sessionId: command.sessionId,
                occurredAt: this.now().toISOString(),
                payload: {
                  quoteId: rankedQuote.quoteId,
                  status: "SUCCESS",
                  venueExecutionRef: gatewayResult.venueExecutionRef ?? null,
                  transactionHash: gatewayResult.transactionHash ?? null
                }
              });
              executionSuccessTotal.inc();
              this.updateExecutionSuccessStats(this.extractLpId(rankedQuote, quoteRecord.quote_payload));

              // Transition to SETTLED on success (using EXECUTING as fromState)
              await this.transitionSessionToState(command.sessionId, "EXECUTING", "SETTLED");

              return {
                ok: true,
                executedQuoteId: rankedQuote.quoteId,
                attempts
              };
            }

            const lpId = this.extractLpId(rankedQuote, quoteRecord.quote_payload);
            await this.persistExecutionFailure({
              sessionId: command.sessionId,
              quoteRecordId: quoteRecord.id,
              ...(lpId ? { lpId } : {}),
              quoteId: rankedQuote.quoteId,
              price: quoteRecord.price,
              quantity: quoteRecord.quantity,
              reason: gatewayResult.reason,
              payload: gatewayResult.executionPayload ?? {}
            });

            attempts.push({
              quoteId: rankedQuote.quoteId,
              status: "FAILED",
              reason: gatewayResult.reason
            });

            if (!command.fallbackToNextQuote) {
              break;
            }
          }

          if (attempts.length > 0 && attempts.every((attempt) => attempt.reason === "QUOTE_NOT_FOUND")) {
            await this.transitionSessionToFailed(command.sessionId, session.status);
            throw new NoValidQuotesError(command.sessionId);
          }

          if (sawStaleQuote && attempts.every((attempt) => attempt.status === "FAILED")) {
            await this.transitionSessionToFailed(command.sessionId, session.status);
            throw new NoValidQuotesError(command.sessionId);
          }

          return {
            ok: false,
            attempts
          };
        } finally {
          await this.deps.sessionManager.releaseLock(command.sessionId);
        }
      }
    );
  }

  private async transitionSessionToState(sessionId: string, currentStatus: string, targetState: RFQState): Promise<void> {
    const fromState = this.asRFQState(currentStatus);
    if (!fromState) {
      this.deps.logger.warn({ sessionId, currentStatus, targetState }, "RFQ status not recognized for transition.");
      return;
    }

    const stateMachine = new RFQStateMachine({
      initialState: fromState,
      logger: {
        info: (payload, message) => this.deps.logger.warn(payload, message),
        error: (payload, message) => this.deps.logger.error(payload, message)
      },
      now: this.now
    });

    if (!stateMachine.canTransitionTo(targetState)) {
      this.deps.logger.error({ sessionId, currentStatus, targetState }, "RFQ status cannot transition to requested state.");
      throw new Error(`Invalid RFQ transition from ${currentStatus} to ${targetState}`);
    }

    const nextState = stateMachine.transitionTo(targetState);

    await this.deps.sessionRepository.updateStatus(sessionId, nextState);
    this.deps.eventEmitter.emitEvent({
      type: "STATE_TRANSITION",
      sessionId,
      occurredAt: this.now().toISOString(),
      payload: {
        from: fromState,
        to: nextState
      }
    });
  }

  private async transitionSessionToFailed(sessionId: string, currentStatus: string): Promise<void> {
    await this.transitionSessionToState(sessionId, currentStatus, "FAILED");
  }

  private asRFQState(value: string): RFQState | null {
    const states = RFQ_STATES as readonly string[];
    if (!states.includes(value)) {
      return null;
    }

    return value as RFQState;
  }

  private async persistExecutionFailure(input: {
    sessionId: string;
    quoteRecordId: string;
    lpId?: string;
    quoteId: string;
    price: string;
    quantity: string;
    reason: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    await this.deps.executionRepository.create({
      sessionId: input.sessionId,
      quoteId: input.quoteRecordId,
      executionStatus: "FAILED",
      executedPrice: input.price,
      executedQuantity: input.quantity,
      executionPayload: {
        quoteId: input.quoteId,
        reason: input.reason,
        ...input.payload
      }
    });

    this.deps.eventEmitter.emitEvent({
      type: "EXECUTION_UPDATE",
      sessionId: input.sessionId,
      occurredAt: this.now().toISOString(),
      payload: {
        quoteId: input.quoteId,
        status: "FAILED",
        reason: input.reason
      }
    });
    executionFailureTotal.inc();
    if (input.lpId) {
      void this.deps.lpStatsRepository
        ?.recordExecutionFailure(input.lpId)
        .catch((error: unknown) => {
          this.deps.logger.error(
            { err: error, sessionId: input.sessionId, quoteId: input.quoteId, lpId: input.lpId },
            "Async LP execution failure stats update failed."
          );
        });
    }
  }

  private extractLpId(
    rankedQuote: RankedQuote,
    quotePayload: unknown
  ): string | null {
    if (typeof rankedQuote.lpId === "string" && rankedQuote.lpId.length > 0) {
      return rankedQuote.lpId;
    }

    if (typeof quotePayload !== "object" || quotePayload === null) {
      return null;
    }

    const quotePayloadRecord = quotePayload as Record<string, unknown>;

    const directLpId = quotePayloadRecord.lpId;
    if (typeof directLpId === "string" && directLpId.length > 0) {
      return directLpId;
    }

    const nestedPayload = quotePayloadRecord.payload;
    if (
      typeof nestedPayload === "object" &&
      nestedPayload !== null &&
      "lpId" in nestedPayload &&
      typeof nestedPayload.lpId === "string" &&
      nestedPayload.lpId.length > 0
    ) {
      return nestedPayload.lpId;
    }

    return null;
  }

  private updateExecutionSuccessStats(lpId: string | null): void {
    if (!lpId) {
      return;
    }

    void this.deps.lpStatsRepository
      ?.recordExecutionSuccess(lpId)
      .catch((error: unknown) => {
        this.deps.logger.error(
          { err: error, lpId },
          "Async LP execution success stats update failed."
        );
      });
  }
}
