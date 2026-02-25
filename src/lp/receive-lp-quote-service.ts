import { RFQEventRepository } from "../db/repositories/rfq-event-repository.js";
import { RFQQuoteRepository } from "../db/repositories/rfq-quote-repository.js";
import { RFQSessionRepository } from "../db/repositories/rfq-session-repository.js";
import { RFQSessionManager } from "../core/rfq-engine/rfq-session-manager.js";
import type { RFQEventEmitter } from "../core/rfq-engine/rfq-domain-events.js";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";

export interface ReceiveLPQuoteCommand {
  routeLpId: string;
  authenticatedLpId: string;
  authenticatedLpKeyId: string;
  authenticatedLpKeyDbId: string;
  sessionId: string;
  quoteId: string;
  price: string;
  quantity: string;
  feeBps: number;
  validUntil: string;
  payload?: Readonly<Record<string, unknown>>;
}

export interface ReceiveLPQuoteResult {
  accepted: true;
  sessionId: string;
  quoteId: string;
}

export interface ReceiveLPQuoteServiceDependencies {
  sessionRepository: RFQSessionRepository;
  quoteRepository: RFQQuoteRepository;
  eventRepository: RFQEventRepository;
  sessionManager: RFQSessionManager;
  redisClient: RedisClient;
  eventEmitter: RFQEventEmitter;
  logger: Pick<Logger, "error">;
  now?: () => Date;
}

export class LPIdentityMismatchError extends Error {
  public constructor() {
    super("LP identity does not match route parameter.");
    this.name = "LPIdentityMismatchError";
  }
}

export class RFQSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`RFQ session ${sessionId} not found.`);
    this.name = "RFQSessionNotFoundError";
  }
}

export class InvalidRFQSessionStateError extends Error {
  public constructor(sessionId: string, currentState: string) {
    super(`RFQ session ${sessionId} is in ${currentState} and not COLLECTING_QUOTES.`);
    this.name = "InvalidRFQSessionStateError";
  }
}

export class DuplicateQuoteIdError extends Error {
  public constructor(quoteId: string) {
    super(`Duplicate quote_id ${quoteId}.`);
    this.name = "DuplicateQuoteIdError";
  }
}

export class ReceiveLPQuoteService {
  private readonly now: () => Date;

  public constructor(private readonly deps: ReceiveLPQuoteServiceDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  public async execute(command: ReceiveLPQuoteCommand): Promise<ReceiveLPQuoteResult> {
    if (command.routeLpId !== command.authenticatedLpId) {
      throw new LPIdentityMismatchError();
    }

    const session = await this.deps.sessionRepository.findById(command.sessionId);
    if (!session) {
      throw new RFQSessionNotFoundError(command.sessionId);
    }

    if (session.status !== "COLLECTING_QUOTES") {
      throw new InvalidRFQSessionStateError(command.sessionId, session.status);
    }

    const idempotencyKey = `rfq:${command.sessionId}:quote_id:${command.quoteId}`;
    const nonceResult = await this.deps.redisClient.set(idempotencyKey, "1", "EX", 3600, "NX");
    if (nonceResult !== "OK") {
      throw new DuplicateQuoteIdError(command.quoteId);
    }

    const numericPrice = Number.parseFloat(command.price);
    const quoteScore = Number.isFinite(numericPrice) ? numericPrice : 0;
    const sessionTtl = await this.deps.sessionManager.getSessionTtl(command.sessionId);
    const quoteTtl = sessionTtl > 0 ? sessionTtl : 300;

    const eventPayload = {
      quoteId: command.quoteId,
      lpId: command.authenticatedLpId,
      lpKeyId: command.authenticatedLpKeyId,
      price: command.price,
      quantity: command.quantity,
      feeBps: command.feeBps,
      validUntil: command.validUntil,
      payload: command.payload ?? {}
    };

    await this.deps.sessionManager.addQuote(
      command.sessionId,
      {
        quoteId: command.quoteId,
        score: quoteScore,
        payload: eventPayload
      },
      quoteTtl
    );

    await this.deps.eventRepository.append({
      sessionId: command.sessionId,
      eventType: "QUOTE_RECEIVED",
      eventPayload
    });

    this.deps.eventEmitter.emitEvent({
      type: "QUOTE_RECEIVED",
      sessionId: command.sessionId,
      occurredAt: this.now().toISOString(),
      payload: eventPayload
    });

    void this.deps.quoteRepository
      .create({
        sessionId: command.sessionId,
        lpKeyId: command.authenticatedLpKeyDbId,
        quoteStatus: "RECEIVED",
        price: command.price,
        quantity: command.quantity,
        feeBps: command.feeBps,
        validUntil: new Date(command.validUntil),
        quotePayload: {
          quoteId: command.quoteId,
          payload: command.payload ?? {}
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.error(
          {
            err: error,
            sessionId: command.sessionId,
            quoteId: command.quoteId
          },
          "Async quote persistence failed."
        );
      });

    return {
      accepted: true,
      sessionId: command.sessionId,
      quoteId: command.quoteId
    };
  }
}

