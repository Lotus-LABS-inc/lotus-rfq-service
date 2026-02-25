import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { RFQEventEmitter } from "../rfq-engine/rfq-domain-events.js";
import type { RankedQuote } from "../ranking/quote-ranking.js";
import { RFQExecutionRepository } from "../../db/repositories/rfq-execution-repository.js";
import { RFQQuoteRepository } from "../../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../rfq-engine/rfq-session-manager.js";

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

export class ExecutionRouterService {
  private readonly now: () => Date;
  private readonly lockOwnerFactory: () => string;
  private readonly lockTtlMs: number;

  public constructor(private readonly deps: ExecutionRouterDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.lockOwnerFactory = deps.lockOwnerFactory ?? (() => randomUUID());
    this.lockTtlMs = deps.lockTtlMs ?? 10000;
  }

  public async execute(command: ExecuteRFQCommand): Promise<ExecuteRFQResult> {
    const session = await this.deps.sessionRepository.findById(command.sessionId);
    if (!session) {
      throw new RFQSessionNotFoundError(command.sessionId);
    }

    const lockOwner = this.lockOwnerFactory();
    const lockAcquired = await this.deps.sessionManager.acquireLock(
      command.sessionId,
      lockOwner,
      this.lockTtlMs
    );

    if (!lockAcquired) {
      throw new RFQLockError(command.sessionId);
    }

    const attempts: ExecutionAttemptResult[] = [];

    try {
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

          if (!command.fallbackToNextQuote) {
            break;
          }
          continue;
        }

        if (quoteRecord.valid_until.getTime() <= this.now().getTime()) {
          await this.persistExecutionFailure({
            sessionId: command.sessionId,
            quoteRecordId: quoteRecord.id,
            quoteId: rankedQuote.quoteId,
            price: quoteRecord.price,
            quantity: quoteRecord.quantity,
            reason: "QUOTE_EXPIRED",
            payload: {}
          });

          attempts.push({
            quoteId: rankedQuote.quoteId,
            status: "FAILED",
            reason: "QUOTE_EXPIRED"
          });

          if (!command.fallbackToNextQuote) {
            break;
          }
          continue;
        }

        const gatewayResult = await this.deps.executionGateway.execute({
          sessionId: command.sessionId,
          quoteId: rankedQuote.quoteId,
          price: quoteRecord.price,
          quantity: quoteRecord.quantity
        });

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

      return {
        ok: false,
        attempts
      };
    } finally {
      await this.deps.sessionManager.releaseLock(command.sessionId);
    }
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
  }
}
