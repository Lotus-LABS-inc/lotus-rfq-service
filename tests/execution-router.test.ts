import { describe, expect, it, vi } from "vitest";
import type { RankedQuote } from "../src/core/ranking/quote-ranking.js";
import type { RFQEventEmitter } from "../src/core/rfq-engine/rfq-domain-events.js";
import type { RFQSessionManager } from "../src/core/rfq-engine/rfq-session-manager.js";
import type { RFQExecutionRepository } from "../src/db/repositories/rfq-execution-repository.js";
import type { RFQQuoteRepository } from "../src/db/repositories/rfq-quote-repository.js";
import type { RFQSessionRepository } from "../src/db/repositories/rfq-session-repository.js";
import {
  ExecutionRouterService,
  NoValidQuotesError,
  RFQLockError
} from "../src/core/execution-router/execution-router.js";

const rankedQuote = (quoteId: string): RankedQuote => ({
  quoteId,
  basePrice: 100,
  venueFee: 1,
  protocolFee: 1,
  gasCost: 1,
  slippageEstimate: 1,
  reliabilityScore: 100,
  latencyScore: 100,
  expires_at: "2026-02-25T11:00:00.000Z",
  firm_until: "2026-02-25T10:30:00.000Z",
  soft_refresh_flag: false,
  effectiveCost: 104,
  score: 104,
  reliabilityBonus: 0,
  latencyBonus: 0,
  failurePenalty: 0,
  rank: 1
});

describe("ExecutionRouterService", () => {
  it("locks rfq, executes valid quote, persists success, and emits execution update", async () => {
    const sessionRepository = {
      findById: vi.fn(async () => ({ id: "session-1", status: "EXECUTING" }))
    } as unknown as RFQSessionRepository;
    const quoteRepository = {
      findByExternalQuoteId: vi.fn(async () => ({
        id: "db-quote-1",
        price: "1.25",
        quantity: "10",
        valid_until: new Date("2026-02-25T11:00:00.000Z")
      }))
    } as unknown as RFQQuoteRepository;
    const executionCreate = vi.fn(async () => ({ id: "exec-1" }));
    const executionRepository = {
      create: executionCreate
    } as unknown as RFQExecutionRepository;
    const sessionManager = {
      acquireLock: vi.fn(async () => true),
      releaseLock: vi.fn(async () => {})
    } as unknown as RFQSessionManager;
    const eventEmitter = {
      emitEvent: vi.fn()
    } as RFQEventEmitter;

    const service = new ExecutionRouterService({
      sessionRepository,
      quoteRepository,
      executionRepository,
      sessionManager,
      executionGateway: {
        execute: vi.fn(async () => ({
          ok: true as const,
          venueExecutionRef: "venue-1",
          transactionHash: "0xabc"
        }))
      },
      eventEmitter,
      logger: { warn: vi.fn(), error: vi.fn() },
      now: () => new Date("2026-02-25T10:00:00.000Z")
    });

    const result = await service.execute({
      sessionId: "session-1",
      rankedQuotes: [rankedQuote("q1")],
      fallbackToNextQuote: false
    });

    expect(result.ok).toBe(true);
    expect(result.executedQuoteId).toBe("q1");
    expect(executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        quoteId: "db-quote-1",
        executionStatus: "SUCCESS"
      })
    );
    expect(eventEmitter.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "EXECUTION_UPDATE",
        sessionId: "session-1"
      })
    );
  });

  it("fails when lock cannot be acquired", async () => {
    const service = new ExecutionRouterService({
      sessionRepository: {
        findById: vi.fn(async () => ({ id: "session-2", status: "EXECUTING" }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        findByExternalQuoteId: vi.fn()
      } as unknown as RFQQuoteRepository,
      executionRepository: {
        create: vi.fn()
      } as unknown as RFQExecutionRepository,
      sessionManager: {
        acquireLock: vi.fn(async () => false),
        releaseLock: vi.fn(async () => {})
      } as unknown as RFQSessionManager,
      executionGateway: {
        execute: vi.fn()
      },
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { warn: vi.fn(), error: vi.fn() }
    });

    await expect(
      service.execute({
        sessionId: "session-2",
        rankedQuotes: [rankedQuote("q2")],
        fallbackToNextQuote: false
      })
    ).rejects.toBeInstanceOf(RFQLockError);
  });

  it("falls back to next ranked quote and persists failed + successful attempts", async () => {
    const executionCreate = vi.fn(async () => ({ id: "exec" }));
    const service = new ExecutionRouterService({
      sessionRepository: {
        findById: vi.fn(async () => ({ id: "session-3", status: "EXECUTING" }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        findByExternalQuoteId: vi
          .fn()
          .mockResolvedValueOnce({
            id: "db-quote-a",
            price: "1.30",
            quantity: "5",
            valid_until: new Date("2026-02-25T11:00:00.000Z")
          })
          .mockResolvedValueOnce({
            id: "db-quote-b",
            price: "1.20",
            quantity: "5",
            valid_until: new Date("2026-02-25T11:00:00.000Z")
          })
      } as unknown as RFQQuoteRepository,
      executionRepository: {
        create: executionCreate
      } as unknown as RFQExecutionRepository,
      sessionManager: {
        acquireLock: vi.fn(async () => true),
        releaseLock: vi.fn(async () => {})
      } as unknown as RFQSessionManager,
      executionGateway: {
        execute: vi
          .fn()
          .mockResolvedValueOnce({
            ok: false as const,
            reason: "VENUE_TIMEOUT"
          })
          .mockResolvedValueOnce({
            ok: true as const
          })
      },
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { warn: vi.fn(), error: vi.fn() },
      now: () => new Date("2026-02-25T10:00:00.000Z")
    });

    const result = await service.execute({
      sessionId: "session-3",
      rankedQuotes: [rankedQuote("qa"), rankedQuote("qb")],
      fallbackToNextQuote: true
    });

    expect(result.ok).toBe(true);
    expect(result.executedQuoteId).toBe("qb");
    expect(executionCreate).toHaveBeenCalledTimes(2);
    expect(result.attempts).toEqual([
      { quoteId: "qa", status: "FAILED", reason: "VENUE_TIMEOUT" },
      { quoteId: "qb", status: "SUCCESS" }
    ]);
  });

  it("rejects stale quote, marks session failed, and throws when no valid quotes remain", async () => {
    const executionCreate = vi.fn(async () => ({ id: "exec-expired" }));
    const sessionUpdateStatus = vi.fn(async () => ({ id: "session-4", status: "FAILED" }));
    const service = new ExecutionRouterService({
      sessionRepository: {
        findById: vi.fn(async () => ({ id: "session-4", status: "EXECUTING" })),
        updateStatus: sessionUpdateStatus
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        findByExternalQuoteId: vi.fn(async () => ({
          id: "db-quote-expired",
          price: "2.00",
          quantity: "2",
          valid_until: new Date("2026-02-25T09:00:00.000Z")
        }))
      } as unknown as RFQQuoteRepository,
      executionRepository: {
        create: executionCreate
      } as unknown as RFQExecutionRepository,
      sessionManager: {
        acquireLock: vi.fn(async () => true),
        releaseLock: vi.fn(async () => {})
      } as unknown as RFQSessionManager,
      executionGateway: {
        execute: vi.fn()
      },
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { warn: vi.fn(), error: vi.fn() },
      now: () => new Date("2026-02-25T10:00:00.000Z")
    });

    await expect(
      service.execute({
        sessionId: "session-4",
        rankedQuotes: [rankedQuote("expired-q")],
        fallbackToNextQuote: false
      })
    ).rejects.toBeInstanceOf(NoValidQuotesError);

    expect(executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        executionStatus: "FAILED"
      })
    );
    expect(sessionUpdateStatus).toHaveBeenCalledWith("session-4", "FAILED");
  });
});
