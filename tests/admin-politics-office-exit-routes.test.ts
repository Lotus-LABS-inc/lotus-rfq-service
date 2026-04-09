import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminPoliticsOfficeExitRoutes } from "../src/api/admin/politics-office-exit.routes.js";

describe("admin politics office-exit routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes tri and pair lane surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const politicsOfficeExitAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        laneType: "TRI",
        venueSet: "LIMITLESS|POLYMARKET|PREDICT",
        propositionSet: ["NETANYAHU_OUT_BEFORE_2027"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        propositionSet: ["NETANYAHU_OUT_BEFORE_2027"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_EXIT_TRUMP_2026_TRI_LIMITLESS_OPINION_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
        laneType: "TRI",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        propositionSet: ["TRUMP_OUT_BEFORE_2027"],
        pairPreferred: false,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_OFFICE_EXIT_TRUMP_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        propositionSet: ["TRUMP_OUT_BEFORE_2027"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        laneType: "TRI",
        venueSet: "LIMITLESS|POLYMARKET|PREDICT",
        propositionSet: ["NETANYAHU_OUT_BEFORE_2027"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT",
        finalReadinessLabel: "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT",
        fallbackLaneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET"
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET",
        fallbackLaneId: null
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPoliticsOfficeExitRoutes(app, adminMiddleware, {
      politicsOfficeExitAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-office-exit-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).lanes).toHaveLength(4);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-office-exit-lanes/POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const trumpReadinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-office-exit-lanes/POLITICS_OFFICE_EXIT_TRUMP_2026_TRI_LIMITLESS_OPINION_POLYMARKET/readiness"
    });
    expect(trumpReadinessResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/politics-office-exit-lanes/POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/politics-office-exit-lanes/POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve office-exit tri lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-office-exit-lanes/POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET/rollback",
      payload: { twoFactorToken: "123456", reason: "hold pair lane" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((politicsOfficeExitAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET",
      "admin-user",
      "hold pair lane"
    );

    await app.close();
  });
});
