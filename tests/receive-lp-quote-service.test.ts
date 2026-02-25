import { describe, expect, it, vi } from "vitest";
import type { RFQEventEmitter } from "../src/core/rfq-engine/rfq-domain-events.js";
import type { RFQSessionManager } from "../src/core/rfq-engine/rfq-session-manager.js";
import type { RedisClient } from "../src/db/redis.js";
import type { RFQEventRepository } from "../src/db/repositories/rfq-event-repository.js";
import type { RFQQuoteRepository } from "../src/db/repositories/rfq-quote-repository.js";
import type { RFQSessionRepository } from "../src/db/repositories/rfq-session-repository.js";
import {
  DuplicateQuoteIdError,
  InvalidRFQSessionStateError,
  ReceiveLPQuoteService
} from "../src/lp/receive-lp-quote-service.js";

describe("ReceiveLPQuoteService", () => {
  it("accepts quote, stores in redis, emits event, and starts async persistence", async () => {
    const sessionRepository = {
      findById: vi.fn(async () => ({
        id: "session-1",
        status: "COLLECTING_QUOTES"
      }))
    } as unknown as RFQSessionRepository;

    const quoteCreate = vi.fn(async () => ({ id: "db-quote-1" }));
    const quoteRepository = {
      create: quoteCreate
    } as unknown as RFQQuoteRepository;

    const eventAppend = vi.fn(async () => ({ id: "evt-1" }));
    const eventRepository = {
      append: eventAppend
    } as unknown as RFQEventRepository;

    const addQuote = vi.fn(async () => {});
    const sessionManager = {
      getSessionTtl: vi.fn(async () => 120),
      addQuote
    } as unknown as RFQSessionManager;

    const redisClient = {
      set: vi.fn(async () => "OK")
    } as unknown as RedisClient;

    const emitEvent = vi.fn();
    const eventEmitter = {
      emitEvent
    } as RFQEventEmitter;

    const service = new ReceiveLPQuoteService({
      sessionRepository,
      quoteRepository,
      eventRepository,
      sessionManager,
      redisClient,
      eventEmitter,
      logger: { error: vi.fn() },
      now: () => new Date("2026-02-25T15:00:00.000Z")
    });

    const result = await service.execute({
      routeLpId: "lp-1",
      authenticatedLpId: "lp-1",
      authenticatedLpKeyId: "api-key-1",
      authenticatedLpKeyDbId: "lp-key-db-1",
      sessionId: "session-1",
      quoteId: "quote-1",
      price: "1.25",
      quantity: "100",
      feeBps: 10,
      validUntil: "2026-02-25T15:05:00.000Z"
    });

    expect(result.accepted).toBe(true);
    expect(addQuote).toHaveBeenCalledTimes(1);
    expect(eventAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        eventType: "QUOTE_RECEIVED"
      })
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "QUOTE_RECEIVED",
        sessionId: "session-1"
      })
    );
    expect(quoteCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects quotes when rfq session is not COLLECTING_QUOTES", async () => {
    const service = new ReceiveLPQuoteService({
      sessionRepository: {
        findById: vi.fn(async () => ({
          id: "session-2",
          status: "BROADCAST"
        }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        create: vi.fn()
      } as unknown as RFQQuoteRepository,
      eventRepository: {
        append: vi.fn()
      } as unknown as RFQEventRepository,
      sessionManager: {
        getSessionTtl: vi.fn(async () => 10),
        addQuote: vi.fn()
      } as unknown as RFQSessionManager,
      redisClient: {
        set: vi.fn(async () => "OK")
      } as unknown as RedisClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { error: vi.fn() }
    });

    await expect(
      service.execute({
        routeLpId: "lp-1",
        authenticatedLpId: "lp-1",
        authenticatedLpKeyId: "api-key-1",
        authenticatedLpKeyDbId: "lp-key-db-1",
        sessionId: "session-2",
        quoteId: "quote-2",
        price: "1.00",
        quantity: "1",
        feeBps: 5,
        validUntil: "2026-02-25T15:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(InvalidRFQSessionStateError);
  });

  it("rejects duplicate quote_id based idempotency key", async () => {
    const service = new ReceiveLPQuoteService({
      sessionRepository: {
        findById: vi.fn(async () => ({
          id: "session-3",
          status: "COLLECTING_QUOTES"
        }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        create: vi.fn()
      } as unknown as RFQQuoteRepository,
      eventRepository: {
        append: vi.fn()
      } as unknown as RFQEventRepository,
      sessionManager: {
        getSessionTtl: vi.fn(async () => 100),
        addQuote: vi.fn()
      } as unknown as RFQSessionManager,
      redisClient: {
        set: vi.fn(async () => null)
      } as unknown as RedisClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { error: vi.fn() }
    });

    await expect(
      service.execute({
        routeLpId: "lp-1",
        authenticatedLpId: "lp-1",
        authenticatedLpKeyId: "api-key-1",
        authenticatedLpKeyDbId: "lp-key-db-1",
        sessionId: "session-3",
        quoteId: "quote-dup",
        price: "1.01",
        quantity: "3",
        feeBps: 5,
        validUntil: "2026-02-25T15:05:00.000Z"
      })
    ).rejects.toBeInstanceOf(DuplicateQuoteIdError);
  });
});

