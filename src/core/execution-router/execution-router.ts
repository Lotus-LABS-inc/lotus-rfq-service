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
  now?: () => Date;
  lockOwnerFactory?: () => string;
  lockTtlMs?: number;
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

              await this.persistExecutionFailure({
                sessionId: command.sessionId,
                quoteRecordId: quoteRecord.id,
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
              await this.deps.executionRepository.create({
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

              attempts.push({
                quoteId: rankedQuote.quoteId,
                status: "SUCCESS"
              });

              return {
                ok: true,
                executedQuoteId: rankedQuote.quoteId,
                attempts
              };
            }

            await this.persistExecutionFailure({
              sessionId: command.sessionId,
              quoteRecordId: quoteRecord.id,
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

  private async transitionSessionToFailed(sessionId: string, currentStatus: string): Promise<void> {
    const fromState = this.asRFQState(currentStatus);
    if (!fromState) {
      this.deps.logger.warn({ sessionId, currentStatus }, "RFQ status not recognized for transition.");
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

    if (!stateMachine.canTransitionTo("FAILED")) {
      this.deps.logger.warn({ sessionId, currentStatus }, "RFQ status cannot transition to FAILED.");
      return;
    }

    const nextState = stateMachine.transitionTo("FAILED", {
      reason: "no_valid_quotes"
    });

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
  }
}
