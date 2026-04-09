import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminPoliticsGeopoliticalRoutes } from "../src/api/admin/politics-geopolitical.routes.js";

describe("admin politics geopolitical routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes tri plus all pair lane surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const politicsGeopoliticalAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        laneType: "TRI",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        propositionSet: ["TRUMP_VISIT_CHINA_BY_2026_04_30"],
        pairPreferred: false,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        laneType: "PAIR",
        venueSet: "OPINION|POLYMARKET",
        propositionSet: ["TRUMP_VISIT_CHINA_BY_2026_04_30"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        laneType: "PAIR",
        venueSet: "OPINION|PREDICT",
        propositionSet: ["TRUMP_VISIT_CHINA_BY_2026_04_30"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        laneType: "PAIR",
        venueSet: "POLYMARKET|PREDICT",
        propositionSet: ["TRUMP_VISIT_CHINA_BY_2026_04_30"],
        pairPreferred: true,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
        laneType: "TRI",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        propositionSet: ["TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: false,
        topicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        laneType: "TRI",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        propositionSet: ["TRUMP_VISIT_CHINA_BY_2026_04_30"],
        pairPreferred: false,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT",
        finalReadinessLabel: "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT",
        fallbackLaneIds: [
          "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_POLYMARKET",
          "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT",
          "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT"
        ]
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT",
        fallbackLaneIds: []
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminPoliticsGeopoliticalRoutes(app, adminMiddleware, {
      politicsGeopoliticalAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-geopolitical-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).lanes).toHaveLength(5);

    const triReadinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT/readiness"
    });
    expect(triReadinessResponse.statusCode).toBe(200);

    const pairReadinessResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT/readiness"
    });
    expect(pairReadinessResponse.statusCode).toBe(200);

    const greenlandRouteResponse = await app.inject({
      method: "GET",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_LIMITLESS_OPINION_POLYMARKET_PREDICT"
    });
    expect(greenlandRouteResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve geopolitical tri lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const holdResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_OPINION_PREDICT/hold",
      payload: { twoFactorToken: "123456", reason: "hold pair lane" }
    });
    expect(holdResponse.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/politics-geopolitical-lanes/POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT/rollback",
      payload: { twoFactorToken: "123456", reason: "rollback pair lane" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((politicsGeopoliticalAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "POLITICS_GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_POLYMARKET_PREDICT",
      "admin-user",
      "rollback pair lane"
    );

    await app.close();
  });
});
