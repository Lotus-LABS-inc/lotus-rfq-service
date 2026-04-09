import Fastify, { type preHandlerHookHandler } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAdminPairMatchReviewRoutes } from "../src/api/admin/pair-match-review.routes.js";

describe("Admin Pair Match Review Routes", () => {
  const originalAdmin2faToken = process.env.ADMIN_2FA_TOKEN;

  afterEach(() => {
    if (originalAdmin2faToken === undefined) {
      delete process.env.ADMIN_2FA_TOKEN;
    } else {
      process.env.ADMIN_2FA_TOKEN = originalAdmin2faToken;
    }
  });

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });
    const pairMatchReviewService = {
      listEdges: vi.fn(async () => []),
      listPendingReview: vi.fn(async () => []),
      getEdge: vi.fn(async () => ({ edge: { id: "edge-1" }, history: [] })),
      approveEdge: vi.fn(async () => ({ edge: { id: "edge-1", approvalState: "approved" }, history: [] })),
      rejectEdge: vi.fn(async () => ({ edge: { id: "edge-1", approvalState: "rejected" }, history: [] }))
    };

    await registerAdminPairMatchReviewRoutes(app, adminMiddleware, {
      pairMatchReviewService: pairMatchReviewService as never
    });

    return { app, pairMatchReviewService };
  };

  it("lists edges behind admin auth", async () => {
    const passThrough: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };
    const { app } = await buildApp(passThrough);

    const response = await app.inject({
      method: "GET",
      url: "/admin/pair-match-review/edges"
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("requires ADMIN + 2FA for approve", async () => {
    process.env.ADMIN_2FA_TOKEN = "654321";
    const passThrough: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };
    const { app, pairMatchReviewService } = await buildApp(passThrough);

    const response = await app.inject({
      method: "POST",
      url: "/admin/pair-match-review/approve",
      payload: {
        twoFactorToken: "123456",
        edgeId: "edge-1",
        reason: "approve exact edge"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(pairMatchReviewService.approveEdge).not.toHaveBeenCalled();
    await app.close();
  });
});
