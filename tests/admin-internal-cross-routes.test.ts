import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAdminInternalCrossRoutes } from "../src/api/admin/internal-cross.routes.js";
import {
  InternalCrossAmbiguityError,
  InternalCrossOrderNotFoundError,
  InternalCrossTradeNotFoundError,
  type InternalCrossAdminService
} from "../src/api/admin/internal-cross-admin-service.js";

describe("Admin Internal Cross Routes", () => {
  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const internalCrossAdminService: InternalCrossAdminService = {
      getTradeInspection: vi.fn(async () => ({
        trade: {
          id: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
          market_id: "market-1",
          buy_order_id: "f6932fb0-8211-42d2-b7e8-bbe3b051223c",
          sell_order_id: "f1ed70ad-96b2-41a9-bd46-7a5e18aa85dc",
          price: "0.55",
          size: "5",
          created_at: new Date()
        },
        buyer_order: {
          id: "f6932fb0-8211-42d2-b7e8-bbe3b051223c",
          market_id: "market-1",
          user_id: "buyer-1",
          side: "buy" as const,
          price: "0.55",
          initial_size: "5",
          remaining_size: "0",
          status: "FILLED",
          created_at: new Date(),
          updated_at: new Date()
        },
        seller_order: {
          id: "f1ed70ad-96b2-41a9-bd46-7a5e18aa85dc",
          market_id: "market-1",
          user_id: "seller-1",
          side: "sell" as const,
          price: "0.55",
          initial_size: "5",
          remaining_size: "0",
          status: "FILLED",
          created_at: new Date(),
          updated_at: new Date()
        },
        exposure_journal_references: [],
        redis_book_presence: {
          buyer_order: { present: false, raw: null },
          seller_order: { present: false, raw: null }
        }
      })),
      getOrderInspection: vi.fn(async () => ({
        order: {
          id: "f6932fb0-8211-42d2-b7e8-bbe3b051223c",
          market_id: "market-1",
          user_id: "buyer-1",
          side: "buy" as const,
          price: "0.55",
          initial_size: "5",
          remaining_size: "2",
          status: "OPEN",
          created_at: new Date(),
          updated_at: new Date()
        },
        redis_book_status: { present: true, raw: { orderId: "f6932fb0-8211-42d2-b7e8-bbe3b051223c" } },
        related_trades: [],
        related_exposure_state: []
      })),
      removeOrderFromBook: vi.fn(async () => ({
        removed: true,
        warning: "Postgres still reports OPEN; verify staleness before recreating book state.",
        admin_event_id: "de59bb7a-3e28-422d-aeeb-6a914537ab8b",
        correlation_id: "164fed37-b0bc-4588-bf82-bc38d1a67560"
      })),
      reconcileTrade: vi.fn(async () => ({
        trade_id: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
        dry_run: true,
        force: false,
        discrepancies: [
          {
            code: "SELL_ORDER_NOT_PERSISTED",
            severity: "critical" as const,
            message: "Seller order state is not present in internal_orders."
          }
        ],
        admin_event_id: "de59bb7a-3e28-422d-aeeb-6a914537ab8b"
      })),
      createForceUnwindTask: vi.fn(async () => ({
        task_id: "143a80a6-07f3-48c4-a5ef-6ddfd50f9074",
        trade_id: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
        correlation_id: "164fed37-b0bc-4588-bf82-bc38d1a67560",
        status: "PENDING",
        admin_event_id: "de59bb7a-3e28-422d-aeeb-6a914537ab8b"
      }))
    } as unknown as InternalCrossAdminService;

    await registerAdminInternalCrossRoutes(app, adminMiddleware, {
      internalCrossAdminService
    });

    return { app, internalCrossAdminService };
  };

  const validTradeId = "64b02512-69d9-49d5-a566-f508a1fd7cd7";
  const validOrderId = "f6932fb0-8211-42d2-b7e8-bbe3b051223c";

  it("denies access when admin middleware rejects", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => {
      return reply.status(403).send({ code: "FORBIDDEN" });
    };
    const { app } = await buildApp(rejectingAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/trade/${validTradeId}`
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("returns trade inspection for GET /admin/internal-cross/trade/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/trade/${validTradeId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalCrossAdminService as unknown as { getTradeInspection: ReturnType<typeof vi.fn> }).getTradeInspection)
      .toHaveBeenCalledWith(validTradeId);
    await app.close();
  });

  it("returns order inspection for GET /admin/internal-cross/order/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/order/${validOrderId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalCrossAdminService as unknown as { getOrderInspection: ReturnType<typeof vi.fn> }).getOrderInspection)
      .toHaveBeenCalledWith(validOrderId);
    await app.close();
  });

  it("requires 2FA token for remove-from-book", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/order/${validOrderId}/remove-from-book`,
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect((internalCrossAdminService as unknown as { removeOrderFromBook: ReturnType<typeof vi.fn> }).removeOrderFromBook)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("remove-from-book route delegates without mutating Postgres directly and returns warning", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/order/${validOrderId}/remove-from-book`,
      payload: {
        reason: "stale redis entry",
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      removed: true,
      warning: expect.stringContaining("OPEN")
    });
    expect((internalCrossAdminService as unknown as { removeOrderFromBook: ReturnType<typeof vi.fn> }).removeOrderFromBook)
      .toHaveBeenCalledWith({
        orderId: validOrderId,
        requestedBy: "admin-1",
        reason: "stale redis entry"
      });
    expect((internalCrossAdminService as unknown as { getOrderInspection: ReturnType<typeof vi.fn> }).getOrderInspection)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("requires 2FA token for reconcile", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/trade/${validTradeId}/reconcile`,
      payload: {
        dryRun: true,
        force: false
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalCrossAdminService as unknown as { reconcileTrade: ReturnType<typeof vi.fn> }).reconcileTrade)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("reconcile route returns discrepancy report", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/trade/${validTradeId}/reconcile`,
      payload: {
        dryRun: true,
        force: false,
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      trade_id: validTradeId,
      discrepancies: [
        {
          code: "SELL_ORDER_NOT_PERSISTED"
        }
      ]
    });
    expect((internalCrossAdminService as unknown as { reconcileTrade: ReturnType<typeof vi.fn> }).reconcileTrade)
      .toHaveBeenCalledWith({
        tradeId: validTradeId,
        requestedBy: "admin-1",
        dryRun: true,
        force: false
      });
    await app.close();
  });

  it("requires 2FA token for force-unwind", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/trade/${validTradeId}/force-unwind`,
      payload: {
        reason: "manual unwind requested"
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalCrossAdminService as unknown as { createForceUnwindTask: ReturnType<typeof vi.fn> }).createForceUnwindTask)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("force-unwind creates task only and does not inspect/mutate directly", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-cross/trade/${validTradeId}/force-unwind`,
      payload: {
        reason: "manual unwind requested",
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      trade_id: validTradeId,
      status: "PENDING"
    });
    expect((internalCrossAdminService as unknown as { createForceUnwindTask: ReturnType<typeof vi.fn> }).createForceUnwindTask)
      .toHaveBeenCalledWith({
        tradeId: validTradeId,
        requestedBy: "admin-1",
        reason: "manual unwind requested"
      });
    expect((internalCrossAdminService as unknown as { getTradeInspection: ReturnType<typeof vi.fn> }).getTradeInspection)
      .not.toHaveBeenCalled();
    expect((internalCrossAdminService as unknown as { reconcileTrade: ReturnType<typeof vi.fn> }).reconcileTrade)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("maps not-found and ambiguity errors", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalCrossAdminService } = await buildApp(passThroughAdmin);

    (internalCrossAdminService as unknown as { getTradeInspection: ReturnType<typeof vi.fn> }).getTradeInspection
      .mockRejectedValueOnce(new InternalCrossTradeNotFoundError(validTradeId));
    const tradeNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/trade/${validTradeId}`
    });
    expect(tradeNotFound.statusCode).toBe(404);

    (internalCrossAdminService as unknown as { getTradeInspection: ReturnType<typeof vi.fn> }).getTradeInspection
      .mockRejectedValueOnce(new InternalCrossAmbiguityError("ambiguous trade"));
    const tradeAmbiguous = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/trade/${validTradeId}`
    });
    expect(tradeAmbiguous.statusCode).toBe(500);

    (internalCrossAdminService as unknown as { getOrderInspection: ReturnType<typeof vi.fn> }).getOrderInspection
      .mockRejectedValueOnce(new InternalCrossOrderNotFoundError(validOrderId));
    const orderNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-cross/order/${validOrderId}`
    });
    expect(orderNotFound.statusCode).toBe(404);

    await app.close();
  });
});
