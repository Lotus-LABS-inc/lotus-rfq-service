import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminReplayRoutes } from "../src/api/admin/replay.routes.js";
import {
  InvalidDiffReplayRequestError,
  ReplayEnvelopeNotFoundError,
  type ReplayAdminService,
} from "../src/api/admin/replay-admin-service.js";

describe("Admin Replay Routes", () => {
  const envelopeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const replayAdminService: ReplayAdminService = {
      getReplayEnvelopeMetadata: vi.fn(async () => ({
        id: envelopeId,
        decisionType: "SOR_PLAN",
        entityId: "rfq-123",
        correlationId: "corr-123",
        configVersion: "planner-v1",
        engineVersion: "sor-v1",
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
      })),
      runExactReplay: vi.fn(async () => ({
        status: "MATCH",
        diffSummary: null,
        replayOutput: { buildResult: { kind: "plan_created" } },
      })),
      runDiffReplay: vi.fn(async () => ({
        status: "DIFF",
        originalOutput: { buildResult: { providerId: "lp-a" } },
        replayOutput: { buildResult: { providerId: "lp-b" } },
        diffSummary: {
          decisionType: "SOR_PLAN",
          diffCount: 1,
          changedRouteChoices: [{ from: "lp-a", to: "lp-b" }],
          changedRanking: [],
          changedClearingSelection: [],
          changedPenaltiesOrGates: [],
          changedEquivalenceClass: null,
          fieldDiffs: [],
        },
        originalConfigVersion: "planner-v1",
        originalEngineVersion: "sor-v1",
        replayConfigVersion: "planner-v2",
        replayEngineVersion: "sor-v1",
      })),
    } as unknown as ReplayAdminService;

    await registerAdminReplayRoutes(app, adminMiddleware, {
      replayAdminService,
    });

    return { app, replayAdminService };
  };

  it("enforces admin auth on all routes", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) =>
      reply.status(403).send({ code: "FORBIDDEN" });
    const { app } = await buildApp(rejectingAdmin);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/admin/replay/envelope/${envelopeId}` }),
      app.inject({
        method: "POST",
        url: `/admin/replay/envelope/${envelopeId}/run`,
        payload: { twoFactorToken: "123456" },
      }),
      app.inject({
        method: "POST",
        url: `/admin/replay/envelope/${envelopeId}/diff`,
        payload: { twoFactorToken: "123456", configVersion: "planner-v2" },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
    }

    await app.close();
  });

  it("returns replay envelope metadata only", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app, replayAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/replay/envelope/${envelopeId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(
      (replayAdminService as unknown as { getReplayEnvelopeMetadata: ReturnType<typeof vi.fn> })
        .getReplayEnvelopeMetadata
    ).toHaveBeenCalledWith(envelopeId);
    expect(response.json()).toEqual({
      envelope: {
        id: envelopeId,
        decisionType: "SOR_PLAN",
        entityId: "rfq-123",
        correlationId: "corr-123",
        configVersion: "planner-v1",
        engineVersion: "sor-v1",
        createdAt: "2026-03-12T00:00:00.000Z",
      },
    });

    await app.close();
  });

  it("requires 2FA for exact replay", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app, replayAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/run`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(
      (replayAdminService as unknown as { runExactReplay: ReturnType<typeof vi.fn> }).runExactReplay
    ).not.toHaveBeenCalled();

    await app.close();
  });

  it("runs exact replay", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app, replayAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/run`,
      payload: { twoFactorToken: "123456" },
    });

    expect(response.statusCode).toBe(200);
    expect(
      (replayAdminService as unknown as { runExactReplay: ReturnType<typeof vi.fn> }).runExactReplay
    ).toHaveBeenCalledWith({
      envelopeId,
      requestedBy: "admin-1",
    });

    await app.close();
  });

  it("runs diff replay and requires at least one override", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app, replayAdminService } = await buildApp(passThroughAdmin);

    const invalidResponse = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/diff`,
      payload: { twoFactorToken: "123456" },
    });
    expect(invalidResponse.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/diff`,
      payload: { twoFactorToken: "123456", configVersion: "planner-v2" },
    });

    expect(response.statusCode).toBe(200);
    expect(
      (replayAdminService as unknown as { runDiffReplay: ReturnType<typeof vi.fn> }).runDiffReplay
    ).toHaveBeenCalledWith({
      envelopeId,
      requestedBy: "admin-1",
      configVersion: "planner-v2",
    });

    await app.close();
  });

  it("maps not found and service failures", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app, replayAdminService } = await buildApp(passThroughAdmin);

    (replayAdminService as unknown as { getReplayEnvelopeMetadata: ReturnType<typeof vi.fn> }).getReplayEnvelopeMetadata
      .mockRejectedValueOnce(new ReplayEnvelopeNotFoundError(envelopeId));
    const notFoundResponse = await app.inject({
      method: "GET",
      url: `/admin/replay/envelope/${envelopeId}`,
    });
    expect(notFoundResponse.statusCode).toBe(404);

    (replayAdminService as unknown as { runDiffReplay: ReturnType<typeof vi.fn> }).runDiffReplay
      .mockRejectedValueOnce(new InvalidDiffReplayRequestError())
      .mockRejectedValueOnce(new Error("boom"));

    const invalidDiffResponse = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/diff`,
      payload: { twoFactorToken: "123456", configVersion: "planner-v2" },
    });
    expect(invalidDiffResponse.statusCode).toBe(400);

    const errorResponse = await app.inject({
      method: "POST",
      url: `/admin/replay/envelope/${envelopeId}/diff`,
      payload: { twoFactorToken: "123456", configVersion: "planner-v2" },
    });
    expect(errorResponse.statusCode).toBe(500);

    await app.close();
  });

  it("rejects malformed params", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN",
      };
    };
    const { app } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: "/admin/replay/envelope/not-a-uuid",
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
