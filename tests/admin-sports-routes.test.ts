import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminSportsRoutes } from "../src/api/admin/sports.routes.js";

describe("admin sports routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes EPL, La Liga, Champions League, World Cup, and NBA lane surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const sportsAdminService = {
      listLanes: vi.fn(async () => ([{
        laneId: "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_SINGLE_LIMITLESS",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        laneType: "SINGLE",
        venueSet: "LIMITLESS",
        clubSet: ["arsenal", "bayern_munich", "real_madrid"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        laneType: "TRI",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        clubSet: ["arsenal", "bayern_munich", "paris_saint_germain", "real_madrid"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["arsenal", "bayern_munich", "paris_saint_germain", "real_madrid"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["arsenal", "liverpool", "manchester_city"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        clubSet: ["arsenal", "aston_villa", "chelsea", "liverpool", "manchester_city", "manchester_united"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_LA_LIGA_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["atletico_madrid", "barcelona", "real_madrid"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_LA_LIGA_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        clubSet: ["atletico_madrid", "barcelona", "real_madrid", "villarreal"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_WORLD_CUP_WINNER_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["brazil", "england", "france", "spain"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_WORLD_CUP_WINNER_2026_PAIR_LIMITLESS_POLYMARKET",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026",
        laneType: "PAIR",
        venueSet: "LIMITLESS|POLYMARKET",
        clubSet: ["argentina", "belgium", "brazil", "croatia", "england", "france", "germany", "italy", "mexico", "netherlands", "portugal", "spain", "united_states", "uruguay"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_NBA_CHAMPION_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["boston_celtics", "detroit_pistons", "oklahoma_city_thunder", "san_antonio_spurs"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }, {
        laneId: "SPORTS_NBA_CHAMPION_2025_2026_PAIR_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026",
        laneType: "PAIR",
        venueSet: "POLYMARKET|PREDICT",
        clubSet: ["boston_celtics", "detroit_pistons", "oklahoma_city_thunder", "san_antonio_spurs"],
        pairPreferred: true,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }])),
      getLane: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        topicKey: "SPORTS|LEAGUE_WINNER|EPL|2025_2026",
        laneType: "STRICT_ALL",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        clubSet: ["arsenal", "liverpool", "manchester_city"],
        pairPreferred: false,
        blockers: ["operator_rule_review_required"],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        finalReadinessLabel: "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        fallbackLaneId: "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET"
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
        fallbackLaneId: "SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET"
      }))
    } as never;

    const app = Fastify({ logger: false });
    await registerAdminSportsRoutes(app, adminMiddleware, {
      sportsAdminService
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/sports-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).lanes).toHaveLength(11);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/sports-lanes/SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_TRI_LIMITLESS_OPINION_POLYMARKET/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const deniedMutation = await app.inject({
      method: "POST",
      url: "/admin/sports-lanes/SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "000000" }
    });
    expect(deniedMutation.statusCode).toBe(403);

    const allowedApprovalIntent = await app.inject({
      method: "POST",
      url: "/admin/sports-lanes/SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT/operator-approval-intent",
      payload: { twoFactorToken: "123456", reason: "approve epl all-venue lane" }
    });
    expect(allowedApprovalIntent.statusCode).toBe(200);

    const holdResponse = await app.inject({
      method: "POST",
      url: "/admin/sports-lanes/SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET/hold",
      payload: { twoFactorToken: "123456", reason: "hold pair lane" }
    });
    expect(holdResponse.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/sports-lanes/SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT/rollback",
      payload: { twoFactorToken: "123456", reason: "rollback all-venue lane" }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((sportsAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT",
      "admin-user",
      "rollback all-venue lane"
    );

    await app.close();
  });
});
