import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAdminSORRoutes } from "../src/api/admin/sor.routes.js";
import {
  PlanNotFoundError,
  ProviderCandidateNotFoundError,
  StepNotFoundError,
  type SORAdminService
} from "../src/api/admin/sor-admin-service.js";

describe("Admin SOR Routes - permission and control flow", () => {
  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const sorAdminService: SORAdminService = {
      getPlanSnapshot: vi.fn(async () => ({
        plan: {
          id: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
          rfq_id: "f6932fb0-8211-42d2-b7e8-bbe3b051223c",
          acceptance_policy: "ALL_OR_NONE",
          reservation_token: "token",
          state: "RUNNING",
          cost_estimate: "10.5",
          metadata: {},
          created_at: new Date()
        },
        route_steps: [],
        provider_candidates: []
      })),
      forceUnwind: vi.fn(async () => ({
        planId: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
        status: "UNWOUND"
      })),
      retryStep: vi.fn(async () => ({
        planId: "64b02512-69d9-49d5-a566-f508a1fd7cd7",
        status: "COMPLETED"
      }))
    } as unknown as SORAdminService;

    await registerAdminSORRoutes(app, adminMiddleware, {
      sorAdminService
    });

    return { app, sorAdminService };
  };

  const validPlanId = "64b02512-69d9-49d5-a566-f508a1fd7cd7";
  const validStepId = "f6932fb0-8211-42d2-b7e8-bbe3b051223c";

  it("denies access when admin middleware rejects", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => {
      return reply.status(403).send({ code: "FORBIDDEN" });
    };
    const { app } = await buildApp(rejectingAdmin);

    const res = await app.inject({
      method: "GET",
      url: `/admin/sor/plan/${validPlanId}`
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns plan snapshot for GET /admin/sor/plan/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    const res = await app.inject({
      method: "GET",
      url: `/admin/sor/plan/${validPlanId}`
    });

    expect(res.statusCode).toBe(200);
    expect((sorAdminService as unknown as { getPlanSnapshot: ReturnType<typeof vi.fn> }).getPlanSnapshot).toHaveBeenCalledWith(validPlanId);
    expect(res.json()).toMatchObject({
      plan: {
        id: validPlanId
      }
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
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    const res = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/force-unwind`,
      payload: {
        reason: "incident-response"
      }
    });

    expect(res.statusCode).toBe(400);
    expect((sorAdminService as unknown as { forceUnwind: ReturnType<typeof vi.fn> }).forceUnwind).not.toHaveBeenCalled();
    await app.close();
  });

  it("calls force-unwind for ADMIN+2FA", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    const res = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/force-unwind`,
      payload: {
        reason: "incident-response",
        twoFactorToken: "123456"
      }
    });

    expect(res.statusCode).toBe(200);
    expect((sorAdminService as unknown as { forceUnwind: ReturnType<typeof vi.fn> }).forceUnwind).toHaveBeenCalledWith({
      planId: validPlanId,
      reason: "incident-response",
      requestedBy: "admin-1"
    });
    await app.close();
  });

  it("requires 2FA token for retry-step", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    const res = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/retry-step`,
      payload: {
        stepId: validStepId,
        newProviderId: "lp-fallback",
        newProviderType: "LP",
        reason: "provider timeout"
      }
    });

    expect(res.statusCode).toBe(400);
    expect((sorAdminService as unknown as { retryStep: ReturnType<typeof vi.fn> }).retryStep).not.toHaveBeenCalled();
    await app.close();
  });

  it("calls retry-step for ADMIN+2FA", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    const res = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/retry-step`,
      payload: {
        stepId: validStepId,
        newProviderId: "lp-fallback",
        newProviderType: "LP",
        reason: "provider timeout",
        twoFactorToken: "123456"
      }
    });

    expect(res.statusCode).toBe(200);
    expect((sorAdminService as unknown as { retryStep: ReturnType<typeof vi.fn> }).retryStep).toHaveBeenCalledWith({
      planId: validPlanId,
      stepId: validStepId,
      newProviderId: "lp-fallback",
      newProviderType: "LP",
      reason: "provider timeout",
      requestedBy: "admin-1"
    });
    await app.close();
  });

  it("maps service errors to expected status codes", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, sorAdminService } = await buildApp(passThroughAdmin);

    (sorAdminService as unknown as { getPlanSnapshot: ReturnType<typeof vi.fn> }).getPlanSnapshot.mockRejectedValueOnce(
      new PlanNotFoundError(validPlanId)
    );
    const getRes = await app.inject({
      method: "GET",
      url: `/admin/sor/plan/${validPlanId}`
    });
    expect(getRes.statusCode).toBe(404);

    (sorAdminService as unknown as { retryStep: ReturnType<typeof vi.fn> }).retryStep.mockRejectedValueOnce(
      new StepNotFoundError(validPlanId, validStepId)
    );
    const retryStepNotFound = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/retry-step`,
      payload: {
        stepId: validStepId,
        newProviderId: "lp-fallback",
        newProviderType: "LP",
        reason: "provider timeout",
        twoFactorToken: "123456"
      }
    });
    expect(retryStepNotFound.statusCode).toBe(404);

    (sorAdminService as unknown as { retryStep: ReturnType<typeof vi.fn> }).retryStep.mockRejectedValueOnce(
      new ProviderCandidateNotFoundError(validPlanId, validStepId, "lp-fallback")
    );
    const retryProviderMissing = await app.inject({
      method: "POST",
      url: `/admin/sor/plan/${validPlanId}/retry-step`,
      payload: {
        stepId: validStepId,
        newProviderId: "lp-fallback",
        newProviderType: "LP",
        reason: "provider timeout",
        twoFactorToken: "123456"
      }
    });
    expect(retryProviderMissing.statusCode).toBe(409);

    await app.close();
  });
});
