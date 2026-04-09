import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminPoliticsPartyControlRoutes } from "../src/api/admin/politics-party-control.routes.js";

describe("admin politics party-control routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes lane readiness surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const politicsPartyControlAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        laneType: "TRI",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        outcomeSet: ["D_SENATE_R_HOUSE", "DEMOCRATS_SWEEP", "REPUBLICANS_SWEEP"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        laneType: "PAIR",
        venueSet: "POLYMARKET|PREDICT",
        outcomeSet: ["D_SENATE_R_HOUSE", "DEMOCRATS_SWEEP", "R_SENATE_D_HOUSE", "REPUBLICANS_SWEEP"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        laneType: "TRI",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        outcomeSet: ["D_SENATE_R_HOUSE", "DEMOCRATS_SWEEP", "REPUBLICANS_SWEEP"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT",
        finalReadinessLabel: "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT",
        fallbackLaneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT"
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT",
        fallbackLaneId: "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT"
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPoliticsPartyControlRoutes(app, adminMiddleware, {
      politicsPartyControlAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-party-control-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).lanes).toHaveLength(2);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-party-control-lanes/POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/politics-party-control-lanes/POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/politics-party-control-lanes/POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve party-control tri lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-party-control-lanes/POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT/rollback",
      payload: { twoFactorToken: "123456", reason: "hold pair lane" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((politicsPartyControlAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT",
      "admin-user",
      "hold pair lane"
    );

    await app.close();
  });
});
