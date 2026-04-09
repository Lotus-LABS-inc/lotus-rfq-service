import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { PairRouteStageTransitionError } from "../../src/api/admin/pair-route-admin-service.js";
import { registerAdminPairPromotionRoutes } from "../../src/api/admin/pair-promotion.routes.js";
import { registerAdminPairShadowRoutes } from "../../src/api/admin/pair-shadow.routes.js";

describe("pair canary promotion routes", () => {
  it("exposes shadow evidence/readiness and enforces ADMIN + 2FA for canary actions", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const pairRouteAdminService = {
      getShadowEvidence: vi.fn(async () => ({ routeClass: "PAIR_PM_LIMITLESS" })),
      getCanaryReadiness: vi.fn(async () => ({ recommendation: "REMAIN_SHADOW" })),
      getPromotionBlockers: vi.fn(async () => ["minimumExactSafeObservations"]),
      promoteCanary: vi.fn(async () => {
        throw new PairRouteStageTransitionError("Canary promotion blocked by evidence policy");
      }),
      revertShadowOnly: vi.fn(async () => ({ qualification: { routeClassId: "PAIR_PM_LIMITLESS" }, event: { id: "evt-revert" } }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPairShadowRoutes(app, adminMiddleware, { pairRouteAdminService });
    await registerAdminPairPromotionRoutes(app, adminMiddleware, { pairRouteAdminService });

    const evidenceResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/shadow-evidence"
    });
    expect(evidenceResponse.statusCode).toBe(200);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/canary-readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const blockerResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/promotion-blockers"
    });
    expect(blockerResponse.statusCode).toBe(200);

    const deniedPromotion = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/promote-canary",
      payload: { twoFactorToken: "000000", reason: "promote" }
    });
    expect(deniedPromotion.statusCode).toBe(403);

    const blockedPromotion = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/promote-canary",
      payload: { twoFactorToken: "123456", reason: "promote" }
    });
    expect(blockedPromotion.statusCode).toBe(409);

    const revertResponse = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/revert-shadow-only",
      payload: { twoFactorToken: "123456", reason: "rollback to shadow" }
    });
    expect(revertResponse.statusCode).toBe(200);
    expect((pairRouteAdminService as any).revertShadowOnly).toHaveBeenCalled();

    await app.close();
  });
});

