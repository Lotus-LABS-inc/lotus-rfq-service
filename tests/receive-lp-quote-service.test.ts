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
  ReceiveLPQuoteService,
  ResolutionRiskQuoteRejectedError
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
      getSessionMetadata: vi.fn(async () => ({
        metadata: {
          resolution_risk_grouping: {
            canonicalEventId: "event-1",
            safePools: [["profile-safe"]],
            cautionLanes: [["profile-caution"]],
            blockedProfiles: ["profile-blocked"],
            reasonsByProfile: {
              "profile-blocked": ["pair:profile-blocked|profile-safe: blocked for pooling"]
            },
            pairMatrix: {}
          }
        }
      })),
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
      ,
      payload: {
        resolution_profile_id: "profile-safe"
      }
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
    expect(addQuote).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            resolution_profile_id: "profile-safe",
            resolution_lane: "safe:0",
            resolution_lane_type: "SAFE_POOL"
          })
        })
      }),
      120
    );
  });

  it("accepts caution quotes but tags them into isolated lanes", async () => {
    const addQuote = vi.fn(async () => {});
    const service = new ReceiveLPQuoteService({
      sessionRepository: {
        findById: vi.fn(async () => ({
          id: "session-caution",
          status: "COLLECTING_QUOTES"
        }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        create: vi.fn(async () => ({ id: "db-quote-2" }))
      } as unknown as RFQQuoteRepository,
      eventRepository: {
        append: vi.fn(async () => ({ id: "evt-2" }))
      } as unknown as RFQEventRepository,
      sessionManager: {
        getSessionTtl: vi.fn(async () => 120),
        getSessionMetadata: vi.fn(async () => ({
          metadata: {
            resolution_risk_grouping: {
              canonicalEventId: "event-1",
              safePools: [],
              cautionLanes: [["profile-caution"]],
              blockedProfiles: [],
              reasonsByProfile: {
                "profile-caution": ["pair:profile-caution|profile-safe: caution lane"]
              },
              pairMatrix: {}
            }
          }
        })),
        addQuote
      } as unknown as RFQSessionManager,
      redisClient: {
        set: vi.fn(async () => "OK")
      } as unknown as RedisClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { error: vi.fn() },
      now: () => new Date("2026-02-25T15:00:00.000Z")
    });

    await service.execute({
      routeLpId: "lp-1",
      authenticatedLpId: "lp-1",
      authenticatedLpKeyId: "api-key-1",
      authenticatedLpKeyDbId: "lp-key-db-1",
      sessionId: "session-caution",
      quoteId: "quote-caution",
      price: "1.10",
      quantity: "10",
      feeBps: 10,
      validUntil: "2026-02-25T15:05:00.000Z",
      payload: {
        resolution_profile_id: "profile-caution"
      }
    });

    expect(addQuote).toHaveBeenCalledWith(
      "session-caution",
      expect.objectContaining({
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            resolution_lane: "caution:0",
            resolution_lane_type: "CAUTION",
            resolution_lane_reason: expect.stringContaining("caution lane")
          })
        })
      }),
      120
    );
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
        getSessionMetadata: vi.fn(async () => null),
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
        getSessionMetadata: vi.fn(async () => null),
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

  it("rejects blocked resolution profile quotes fail-closed", async () => {
    const service = new ReceiveLPQuoteService({
      sessionRepository: {
        findById: vi.fn(async () => ({
          id: "session-4",
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
        getSessionMetadata: vi.fn(async () => ({
          metadata: {
            resolution_risk_grouping: {
              canonicalEventId: "event-1",
              safePools: [],
              cautionLanes: [],
              blockedProfiles: ["profile-blocked"],
              reasonsByProfile: {
                "profile-blocked": ["pair:profile-blocked|profile-safe: high risk block"]
              },
              pairMatrix: {}
            }
          }
        })),
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
        sessionId: "session-4",
        quoteId: "quote-blocked",
        price: "1.01",
        quantity: "3",
        feeBps: 5,
        validUntil: "2026-02-25T15:05:00.000Z",
        payload: {
          resolution_profile_id: "profile-blocked"
        }
      })
    ).rejects.toBeInstanceOf(ResolutionRiskQuoteRejectedError);
  });

  it("accepts quotes when shadow-mode grouping stored a permissive enforced lane", async () => {
    const addQuote = vi.fn(async () => {});
    const service = new ReceiveLPQuoteService({
      sessionRepository: {
        findById: vi.fn(async () => ({
          id: "session-shadow",
          status: "COLLECTING_QUOTES"
        }))
      } as unknown as RFQSessionRepository,
      quoteRepository: {
        create: vi.fn(async () => ({ id: "db-quote-shadow" }))
      } as unknown as RFQQuoteRepository,
      eventRepository: {
        append: vi.fn(async () => ({ id: "evt-shadow" }))
      } as unknown as RFQEventRepository,
      sessionManager: {
        getSessionTtl: vi.fn(async () => 120),
        getSessionMetadata: vi.fn(async () => ({
          metadata: {
            resolution_risk_grouping: {
              canonicalEventId: "event-1",
              safePools: [["profile-blocked", "profile-safe"]],
              cautionLanes: [],
              blockedProfiles: [],
              reasonsByProfile: {},
              pairMatrix: {}
            },
            resolution_risk_shadow_grouping: {
              canonicalEventId: "event-1",
              safePools: [["profile-safe"]],
              cautionLanes: [],
              blockedProfiles: ["profile-blocked"],
              reasonsByProfile: {
                "profile-blocked": ["pair:profile-blocked|profile-safe: would block in shadow"]
              },
              pairMatrix: {}
            },
            resolution_risk_policy: {
              mode: "shadow",
              enforcement_active: false
            }
          }
        })),
        addQuote
      } as unknown as RFQSessionManager,
      redisClient: {
        set: vi.fn(async () => "OK")
      } as unknown as RedisClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: { error: vi.fn() },
      now: () => new Date("2026-02-25T15:00:00.000Z")
    });

    const result = await service.execute({
      routeLpId: "lp-1",
      authenticatedLpId: "lp-1",
      authenticatedLpKeyId: "api-key-1",
      authenticatedLpKeyDbId: "lp-key-db-1",
      sessionId: "session-shadow",
      quoteId: "quote-shadow",
      price: "1.15",
      quantity: "10",
      feeBps: 10,
      validUntil: "2026-02-25T15:05:00.000Z",
      payload: {
        resolution_profile_id: "profile-blocked"
      }
    });

    expect(result.accepted).toBe(true);
    expect(addQuote).toHaveBeenCalledWith(
      "session-shadow",
      expect.objectContaining({
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            resolution_profile_id: "profile-blocked",
            resolution_lane: "safe:0",
            resolution_lane_type: "SAFE_POOL"
          })
        })
      }),
      120
    );
  });
});
