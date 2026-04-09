import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { registerAdminPairQualificationRoutes } from "../../src/api/admin/pair-qualification.routes.js";
import { registerAdminPairRolloutRoutes } from "../../src/api/admin/pair-rollout.routes.js";

describe("pair rollout admin routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes readiness endpoints", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };
    const pairRouteAdminService = {
      listPairRoutes: vi.fn(async () => [{ routeClassId: "PAIR_PM_LIMITLESS" }]),
      getPairRoute: vi.fn(async () => ({
        routeClassId: "PAIR_PM_LIMITLESS",
        currentStage: QualificationStage.INTERNAL_ONLY,
        readinessState: "SHADOW_READY",
        recommendation: "SHADOW",
        historicalQualification: {},
        liveQualification: {},
        mixedBasisDiagnostic: {},
        riskProfile: {},
        evidenceRefs: []
      })),
      getPairRouteCoverage: vi.fn(async () => ({ qualification: { routeClassId: "PAIR_PM_LIMITLESS" }, rolloutSummary: {} })),
      getCryptoProdReadiness: vi.fn(async () => ({ routeClass: "PAIR_PM_LIMITLESS", readinessDecision: "READY_FOR_CANARY_PENDING_OPERATOR_ACTION" })),
      getCanaryScopeLock: vi.fn(async () => ({ routeClass: "PAIR_PM_OPINION", scopeDecision: "LOCKED" })),
      getCanaryApprovalState: vi.fn(async () => ({ routeClass: "PAIR_PM_OPINION", approvalState: "APPROVED_PENDING_ACTIVATION" })),
      getFinalCanaryPackage: vi.fn(async () => ({ routeClass: "PAIR_PM_OPINION", finalDecision: "CANARY_PACKAGE_READY_PENDING_ACTIVATION" })),
      getCryptoLaunchPlan: vi.fn(async () => ({ routeClass: "PAIR_PM_LIMITLESS", scopePromoted: "safe_exact_subset_only" })),
      getCryptoRollbackPlan: vi.fn(async () => ({ routeClass: "PAIR_PM_LIMITLESS", rollbackTargetStage: "SHADOW" })),
      recordOperatorApprovalIntent: vi.fn(async () => ({ routeClass: "PAIR_PM_OPINION", scopeLabel: "btc_exact_slice_only" })),
      promoteShadow: vi.fn(async () => ({ qualification: { routeClassId: "PAIR_PM_LIMITLESS" }, event: { id: "evt-1" } })),
      promoteCanary: vi.fn(async () => ({ qualification: { routeClassId: "PAIR_PM_LIMITLESS" }, event: { id: "evt-2" } })),
      demote: vi.fn(async () => ({ qualification: { routeClassId: "PAIR_PM_LIMITLESS" }, event: { id: "evt-3" } }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPairRolloutRoutes(app, adminMiddleware, { pairRouteAdminService });
    await registerAdminPairQualificationRoutes(app, adminMiddleware, { pairRouteAdminService });

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const cryptoReadinessResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/crypto-prod-readiness"
    });
    expect(cryptoReadinessResponse.statusCode).toBe(200);

    const scopeLockResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_OPINION/canary-scope-lock"
    });
    expect(scopeLockResponse.statusCode).toBe(200);

    const approvalStateResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_OPINION/canary-approval-state"
    });
    expect(approvalStateResponse.statusCode).toBe(200);

    const finalPackageResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_OPINION/final-canary-package"
    });
    expect(finalPackageResponse.statusCode).toBe(200);

    const launchPlanResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/launch-plan"
    });
    expect(launchPlanResponse.statusCode).toBe(200);

    const rollbackPlanResponse = await app.inject({
      method: "GET",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/rollback-plan"
    });
    expect(rollbackPlanResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/promote-shadow",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedMutation = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_LIMITLESS/promote-shadow",
      payload: { twoFactorToken: "123456", reason: "start shadow" }
    });
    expect(allowedMutation.statusCode).toBe(200);
    expect((pairRouteAdminService as any).promoteShadow).toHaveBeenCalled();

    const approvalIntentResponse = await app.inject({
      method: "POST",
      url: "/admin/pair-routes/PAIR_PM_OPINION/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "operator approved crypto canary" }
    });
    expect(approvalIntentResponse.statusCode).toBe(200);
    expect((pairRouteAdminService as any).recordOperatorApprovalIntent).toHaveBeenCalled();

    await app.close();
  });
});
