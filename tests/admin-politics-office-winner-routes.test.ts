import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminPoliticsOfficeWinnerRoutes } from "../src/api/admin/politics-office-winner.routes.js";

describe("admin politics office-winner routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes lane readiness surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const politicsOfficeWinnerAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "POLITICS_OFFICE_WINNER_US_PRESIDENT_2028_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|USA|US_PRESIDENT|2028",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["donald_trump"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|BUSAN|MAYOR|2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["park_heong_joon"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["sergio_fajardo_dc"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_LIMITLESS_OPINION_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        laneType: "TRI",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        candidateSet: ["chong_won_oh"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        candidateSet: ["chong_won_oh"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_LIMITLESS_OPINION_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        laneType: "TRI",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        candidateSet: ["chong_won_oh"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET",
        finalReadinessLabel: "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET",
        fallbackLaneId: null
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET",
        fallbackLaneId: null
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPoliticsOfficeWinnerRoutes(app, adminMiddleware, {
      politicsOfficeWinnerAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-office-winner-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).lanes).toHaveLength(5);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-office-winner-lanes/POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/politics-office-winner-lanes/POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/politics-office-winner-lanes/POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve office-winner narrow lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-office-winner-lanes/POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET/rollback",
      payload: { twoFactorToken: "123456", reason: "hold for rule review" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((politicsOfficeWinnerAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "POLITICS_OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_LIMITLESS_POLYMARKET",
      "admin-user",
      "hold for rule review"
    );

    await app.close();
  });
});
