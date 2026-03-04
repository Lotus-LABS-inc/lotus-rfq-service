import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, it, expect, vi } from "vitest";
import { registerAdminComboRoutes } from "../src/api/admin/combo.routes.js";
import type { AdminComboRouteDeps } from "../src/api/admin/combo.routes.js";

describe("Admin Combo Routes - permission and basic behavior", () => {
  const buildApp = async (adminMiddleware: preHandlerHookHandler, depsOverrides: Partial<AdminComboRouteDeps> = {}) => {
    const app = Fastify({ logger: false });

    const comboRepo = {
      getSession: vi.fn(),
      createSession: vi.fn(),
      updateSessionState: vi.fn()
    };

    const exposureRepo = {
      getExposureForUpdate: vi.fn(),
      createExposure: vi.fn(),
      updateExposureWithJournal: vi.fn(),
      applyExecutionIdempotent: vi.fn(),
      listAllExposures: vi.fn(),
      getExposure: vi.fn()
    };

    const exposureCache = {
      getRollingExposure: vi.fn()
    };

    const deps: AdminComboRouteDeps = {
      comboRepo: depsOverrides.comboRepo ?? (comboRepo as any),
      exposureRepo: depsOverrides.exposureRepo ?? (exposureRepo as any),
      exposureCache: depsOverrides.exposureCache ?? (exposureCache as any)
    };

    await registerAdminComboRoutes(app, adminMiddleware, deps);
    return { app, comboRepo, exposureRepo, exposureCache };
  };

  it("denies access when admin middleware responds with 403", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_req, reply) => {
      return reply.status(403).send({ error: "forbidden" });
    };

    const { app } = await buildApp(rejectingAdmin);

    const res = await app.inject({
      method: "GET",
      url: "/admin/combo/123"
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when combo is missing", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, comboRepo } = await buildApp(passThroughAdmin);

    (comboRepo.getSession as any).mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/admin/combo/non-existent-id"
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("requires 2FA token for force-complete", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, comboRepo } = await buildApp(passThroughAdmin);

    (comboRepo.getSession as any).mockResolvedValue({
      id: "combo-1",
      userId: "user-1",
      state: "OPEN",
      acceptancePolicy: "ALL_OR_NONE",
      expiresAt: new Date().toISOString(),
      metadata: {},
      createdAt: new Date(),
      legs: []
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/combo/combo-1/force-complete",
      payload: {
        reason: "test-complete-no-2fa"
      }
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("allows force-fail for admin and updates state via repo", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, comboRepo } = await buildApp(passThroughAdmin);

    (comboRepo.getSession as any).mockResolvedValue({
      id: "combo-1",
      userId: "user-1",
      state: "OPEN",
      acceptancePolicy: "ALL_OR_NONE",
      expiresAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      legs: []
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/combo/combo-1/force-fail",
      payload: {
        reason: "manual-fail"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(comboRepo.updateSessionState).toHaveBeenCalledWith("combo-1", "FAILED");
    await app.close();
  });

  it("allows force-complete for admin with 2FA", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, comboRepo } = await buildApp(passThroughAdmin);

    (comboRepo.getSession as any).mockResolvedValue({
      id: "combo-2",
      userId: "user-2",
      state: "OPEN",
      acceptancePolicy: "ALL_OR_NONE",
      expiresAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      legs: []
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/combo/combo-2/force-complete",
      payload: {
        reason: "manual-complete",
        twoFactorToken: "123456"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(comboRepo.updateSessionState).toHaveBeenCalledWith("combo-2", "EXECUTED");
    await app.close();
  });
});

