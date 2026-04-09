import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminPoliticsNomineeRoutes } from "../src/api/admin/politics-nominee.routes.js";

describe("admin politics nominee routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes lane readiness surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const politicsNomineeAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["jd_vance"],
        pairPreferred: true,
        triAllowed: false,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["jd_vance"],
        pairPreferred: true,
        triAllowed: false,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      })),
      getCanaryGates: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
        gateDecision: "CANARY_GATES_PASSED"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
        fallbackLaneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET"
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
        fallbackLaneId: "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET"
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPoliticsNomineeRoutes(app, adminMiddleware, {
      politicsNomineeAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-nominee-lanes"
    });
    expect(listResponse.statusCode).toBe(200);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-nominee-lanes/POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/politics-nominee-lanes/POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/politics-nominee-lanes/POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve narrow pair lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-nominee-lanes/POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET/rollback",
      payload: { twoFactorToken: "123456", reason: "fallback to pair" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((politicsNomineeAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
      "admin-user",
      "fallback to pair"
    );

    await app.close();
  });
});
