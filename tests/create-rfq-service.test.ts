import { describe, expect, it, vi } from "vitest";
import {
  CanonicalMarketResolutionMetadataError,
  CreateRFQService,
  MarketInactiveError
} from "../src/core/rfq-engine/create-rfq-service.js";
import type { RFQSessionManager } from "../src/core/rfq-engine/rfq-session-manager.js";
import type { RFQSessionRepository } from "../src/db/repositories/rfq-session-repository.js";
import type { RFQEventRepository } from "../src/db/repositories/rfq-event-repository.js";
import type { CanonicalMarketClient } from "../src/core/rfq-engine/canonical-market-client.js";
import type { RFQEventEmitter } from "../src/core/rfq-engine/rfq-domain-events.js";

const loggerStub = {
  info: vi.fn<(payload: Record<string, unknown>, message: string) => void>(),
  error: vi.fn<(payload: Record<string, unknown>, message: string) => void>()
};

describe("CreateRFQService", () => {
  it("creates session, initializes redis, transitions to BROADCAST, and emits RFQ_CREATED", async () => {
    const setSessionMetadata = vi.fn(async () => {});
    const sessionRepository = {
      create: vi.fn(async () => ({
        id: "session-1",
        request_id: "req-1",
        canonical_market_id: "mkt-1",
        taker_id: "taker-1",
        side: "buy",
        quantity: "5",
        status: "CREATED",
        idempotency_key: "idemp-1",
        expires_at: new Date("2026-02-25T12:01:00.000Z"),
        metadata: {},
        created_at: new Date("2026-02-25T12:00:00.000Z"),
        updated_at: new Date("2026-02-25T12:00:00.000Z")
      })),
      updateStatus: vi.fn(async () => ({
        id: "session-1",
        status: "BROADCAST"
      }))
    } as unknown as RFQSessionRepository;

    const eventRepository = {
      append: vi.fn(async () => ({
        id: "evt-1"
      }))
    } as unknown as RFQEventRepository;

    const sessionManager = {
      setSessionMetadata
    } as unknown as RFQSessionManager;

    const canonicalMarketClient = {
      fetchMarketById: vi.fn(async () => ({
        id: "mkt-1",
        canonicalEventId: "event-1",
        isActive: true
      }))
    } as CanonicalMarketClient;

    const eventEmitter = {
      emitEvent: vi.fn()
    } as RFQEventEmitter;
    const riskEngine = {
      validateRFQCreation: vi.fn(async () => undefined),
      validateBeforeExecution: vi.fn(async () => "reservation-token"),
      updateExposureAfterExecution: vi.fn(async () => undefined),
      reconcileExposureSnapshot: vi.fn(async () => undefined)
    };

    const service = new CreateRFQService({
      sessionRepository,
      eventRepository,
      sessionManager,
      canonicalMarketClient,
      eventEmitter,
      logger: loggerStub,
      riskEngine,
      resolutionRiskGroupingService: {
        groupProfilesForCanonicalEvent: vi.fn(async () => ({
          canonicalEventId: "event-1",
          safePools: [["profile-a", "profile-b"]],
          cautionLanes: [],
          blockedProfiles: [],
          reasonsByProfile: {},
          pairMatrix: {}
        }))
      },
      now: () => new Date("2026-02-25T12:00:00.000Z"),
      createRequestId: () => "req-1"
    });

    const result = await service.execute({
      canonicalMarketId: "mkt-1",
      takerId: "taker-1",
      side: "buy",
      quantity: "5",
      idempotencyKey: "idemp-1",
      ttlSeconds: 60
    });

    expect(result.state).toBe("BROADCAST");
    expect(canonicalMarketClient.fetchMarketById).toHaveBeenCalledWith("mkt-1");
    expect(eventRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        eventType: "RFQ_CREATED",
        eventPayload: expect.objectContaining({
          canonicalEventId: "event-1",
          resolution_risk_grouping: expect.objectContaining({
            safePools: [["profile-a", "profile-b"]]
          })
        })
      })
    );
    expect(eventEmitter.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RFQ_CREATED",
        sessionId: "session-1"
      })
    );
    expect(setSessionMetadata).toHaveBeenCalledTimes(2);
    expect(setSessionMetadata).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution_risk_grouping: expect.objectContaining({
            safePools: [["profile-a", "profile-b"]]
          })
        })
      }),
      60
    );
  });

  it("fails when canonical market is inactive", async () => {
    const service = new CreateRFQService({
      sessionRepository: {
        create: vi.fn(),
        updateStatus: vi.fn()
      } as unknown as RFQSessionRepository,
      eventRepository: {
        append: vi.fn()
      } as unknown as RFQEventRepository,
      sessionManager: {
        setSessionMetadata: vi.fn()
      } as unknown as RFQSessionManager,
      canonicalMarketClient: {
        fetchMarketById: vi.fn(async () => ({
          id: "mkt-2",
          isActive: false
        }))
      } as CanonicalMarketClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: loggerStub,
      riskEngine: {
        validateRFQCreation: vi.fn(async () => undefined),
        validateBeforeExecution: vi.fn(async () => "reservation-token"),
        updateExposureAfterExecution: vi.fn(async () => undefined),
        reconcileExposureSnapshot: vi.fn(async () => undefined)
      },
      resolutionRiskGroupingService: {
        groupProfilesForCanonicalEvent: vi.fn()
      }
    });

    await expect(
      service.execute({
        canonicalMarketId: "mkt-2",
        takerId: "taker-1",
        side: "sell",
        quantity: "2",
        idempotencyKey: "idemp-2",
        ttlSeconds: 30
      })
    ).rejects.toBeInstanceOf(MarketInactiveError);
  });

  it("fails closed when canonical market is missing canonical event metadata", async () => {
    const service = new CreateRFQService({
      sessionRepository: {
        create: vi.fn(),
        updateStatus: vi.fn()
      } as unknown as RFQSessionRepository,
      eventRepository: {
        append: vi.fn()
      } as unknown as RFQEventRepository,
      sessionManager: {
        setSessionMetadata: vi.fn()
      } as unknown as RFQSessionManager,
      canonicalMarketClient: {
        fetchMarketById: vi.fn(async () => ({
          id: "mkt-3",
          isActive: true
        }))
      } as CanonicalMarketClient,
      eventEmitter: {
        emitEvent: vi.fn()
      } as RFQEventEmitter,
      logger: loggerStub,
      riskEngine: {
        validateRFQCreation: vi.fn(async () => undefined),
        validateBeforeExecution: vi.fn(async () => "reservation-token"),
        updateExposureAfterExecution: vi.fn(async () => undefined),
        reconcileExposureSnapshot: vi.fn(async () => undefined)
      },
      resolutionRiskGroupingService: {
        groupProfilesForCanonicalEvent: vi.fn()
      }
    });

    await expect(
      service.execute({
        canonicalMarketId: "mkt-3",
        takerId: "taker-1",
        side: "buy",
        quantity: "1",
        idempotencyKey: "idemp-3",
        ttlSeconds: 30
      })
    ).rejects.toBeInstanceOf(CanonicalMarketResolutionMetadataError);
  });

  it("stores permissive enforced grouping and preserves shadow grouping when resolution risk is shadow-only", async () => {
    const setSessionMetadata = vi.fn(async () => {});
    const eventRepository = {
      append: vi.fn(async () => ({ id: "evt-shadow-1" }))
    } as unknown as RFQEventRepository;
    const eventEmitter = {
      emitEvent: vi.fn()
    } as RFQEventEmitter;

    const service = new CreateRFQService({
      sessionRepository: {
        create: vi.fn(async () => ({
          id: "session-shadow-1",
          request_id: "req-shadow-1",
          canonical_market_id: "mkt-shadow-1",
          taker_id: "taker-shadow-1",
          side: "buy",
          quantity: "5",
          status: "CREATED",
          idempotency_key: "idemp-shadow-1",
          expires_at: new Date("2026-02-25T12:01:00.000Z"),
          metadata: {},
          created_at: new Date("2026-02-25T12:00:00.000Z"),
          updated_at: new Date("2026-02-25T12:00:00.000Z")
        })),
        updateStatus: vi.fn(async () => ({
          id: "session-shadow-1",
          status: "BROADCAST"
        }))
      } as unknown as RFQSessionRepository,
      eventRepository,
      sessionManager: {
        setSessionMetadata
      } as unknown as RFQSessionManager,
      canonicalMarketClient: {
        fetchMarketById: vi.fn(async () => ({
          id: "mkt-shadow-1",
          canonicalEventId: "event-shadow-1",
          isActive: true
        }))
      } as CanonicalMarketClient,
      eventEmitter,
      logger: loggerStub,
      riskEngine: {
        validateRFQCreation: vi.fn(async () => undefined),
        validateBeforeExecution: vi.fn(async () => "reservation-token"),
        updateExposureAfterExecution: vi.fn(async () => undefined),
        reconcileExposureSnapshot: vi.fn(async () => undefined)
      },
      resolutionRiskGroupingService: {
        groupProfilesForCanonicalEvent: vi.fn(async () => ({
          canonicalEventId: "event-shadow-1",
          safePools: [["profile-safe"]],
          cautionLanes: [["profile-caution"]],
          blockedProfiles: ["profile-blocked"],
          reasonsByProfile: {
            "profile-caution": ["pair:profile-caution|profile-safe: caution lane"],
            "profile-blocked": ["pair:profile-blocked|profile-safe: blocked"]
          },
          pairMatrix: {}
        }))
      },
      resolutionRiskPolicyService: {
        applyRFQGrouping: vi.fn((grouping) => ({
          grouping: {
            canonicalEventId: grouping.canonicalEventId,
            safePools: [["profile-blocked", "profile-caution", "profile-safe"]],
            cautionLanes: [],
            blockedProfiles: [],
            reasonsByProfile: {},
            pairMatrix: grouping.pairMatrix
          },
          enforcementActive: false,
          mode: "shadow",
          shadowGrouping: grouping
        }))
      } as never,
      now: () => new Date("2026-02-25T12:00:00.000Z"),
      createRequestId: () => "req-shadow-1"
    });

    await service.execute({
      canonicalMarketId: "mkt-shadow-1",
      takerId: "taker-shadow-1",
      side: "buy",
      quantity: "5",
      idempotencyKey: "idemp-shadow-1",
      ttlSeconds: 60
    });

    expect(setSessionMetadata).toHaveBeenCalledWith(
      "session-shadow-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          resolution_risk_grouping: expect.objectContaining({
            safePools: [["profile-blocked", "profile-caution", "profile-safe"]],
            cautionLanes: [],
            blockedProfiles: []
          }),
          resolution_risk_shadow_grouping: expect.objectContaining({
            cautionLanes: [["profile-caution"]],
            blockedProfiles: ["profile-blocked"]
          }),
          resolution_risk_policy: {
            mode: "shadow",
            enforcement_active: false
          }
        })
      }),
      60
    );

    expect(eventRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventPayload: expect.objectContaining({
          resolution_risk_grouping: expect.objectContaining({
            blockedProfiles: []
          }),
          resolution_risk_shadow_grouping: expect.objectContaining({
            blockedProfiles: ["profile-blocked"]
          })
        })
      })
    );
  });
});
