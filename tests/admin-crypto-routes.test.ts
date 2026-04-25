import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminCryptoRoutes } from "../src/api/admin/crypto.routes.js";

describe("admin crypto routes", () => {
  it("requires ADMIN + 2FA for mutations and exposes mixed-family crypto lane surfaces", async () => {
    process.env.ADMIN_2FA_TOKEN = "123456";
    const adminMiddleware: preHandlerHookHandler = async (request) => {
      (request as typeof request & { user: { userId: string; role: string } }).user = {
        userId: "admin-user",
        role: "ADMIN"
      };
    };

    const cryptoAdminService = {
      listLanes: vi.fn(async () => [
        {
          laneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
          familyKey: "CRYPTO|ATH_BY_DATE|BTC",
          venueSet: "LIMITLESS|POLYMARKET",
          candidateSet: ["2026-06-30", "2026-09-30", "2026-12-31"]
        },
        {
          laneId: "CRYPTO_ETH_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
          familyKey: "CRYPTO|ATH_BY_DATE|ETH",
          venueSet: "LIMITLESS|POLYMARKET",
          candidateSet: ["2026-06-30", "2026-09-30", "2026-12-31"]
        },
        {
          laneId: "CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
          familyKey: "CRYPTO|ATH_BY_DATE|SOL",
          venueSet: "LIMITLESS|POLYMARKET",
          candidateSet: ["2026-06-30", "2026-09-30", "2026-12-31"]
        },
        {
          laneId: "CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
          familyKey: "CRYPTO|ATH_BY_DATE|XRP",
          venueSet: "LIMITLESS|POLYMARKET",
          candidateSet: ["2026-06-30", "2026-09-30", "2026-12-31"]
        },
        {
          laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["above 85,000", "above 100,000", "below 70,000"]
        },
        {
          laneId: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["above 4,000", "above 5,000", "below 2,000"]
        },
        {
          laneId: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["above 250", "above 300", "below 100"]
        },
        {
          laneId: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["above 1,000", "above 1,250", "below 500"]
        },
        {
          laneId: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$60k first", "$80k first"]
        },
        {
          laneId: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$1,000 first", "$3,000 first"]
        },
        {
          laneId: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$60 first", "$140 first"]
        },
        {
          laneId: "CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$150M", "$300M", "$500M", "$800M", "$1B", "$2B", "$3B"]
        },
        {
          laneId: "CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$700M", "$1B", "$2B", "$3B", "$4B"]
        },
        {
          laneId: "CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|OPENSEA|ONE_DAY_AFTER_LAUNCH",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$500M", "$1B", "$2B", "$3B", "$5B"]
        },
        {
          laneId: "CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|REYA|ONE_DAY_AFTER_LAUNCH",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["$150M", "$200M", "$300M", "$400M", "$1B"]
        },
        {
          laneId: "CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|TOKEN_LAUNCH_BY_DATE|METAMASK",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["2025-12-31", "2026-06-30", "2026-09-30"]
        },
        {
          laneId: "CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT",
          familyKey: "CRYPTO|TOKEN_LAUNCH_BY_DATE|BASE",
          venueSet: "POLYMARKET|PREDICT",
          candidateSet: ["2026-06-30", "2026-12-31"]
        }
      ].map((lane) => ({
        laneId: lane.laneId,
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        familyKey: lane.familyKey,
        laneType: "PAIR",
        venueSet: lane.venueSet,
        candidateSet: lane.candidateSet,
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      }))),
      getLane: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        operatorCredible: true,
        operatorRuleReviewRequired: true,
        familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
        laneType: "PAIR",
        venueSet: "POLYMARKET|PREDICT",
        candidateSet: ["above 85,000", "above 100,000", "below 70,000"],
        blockers: [],
        sourceArtifactRefs: [],
        currentStage: "INTERNAL_ONLY"
      })),
      getReadiness: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
        finalReadinessLabel: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
      })),
      getRollbackPlan: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
        fallbackLaneId: null
      })),
      getLaneAuthorityState: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
        familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
        laneType: "PAIR",
        venueSet: "POLYMARKET|PREDICT",
        candidateSet: ["above 85,000", "above 100,000", "below 70,000"],
        readinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
        currentStage: "INTERNAL_ONLY",
        latestEventId: null,
        latestEventAt: null,
        latestActionKind: null,
        operatorApprovedToOffer: false
      })),
      recordOperatorApprovalIntent: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT"
      })),
      holdLane: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT"
      })),
      rollbackLane: vi.fn(async () => ({
        laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
        fallbackLaneId: null
      }))
    };

    const app = Fastify();
    await registerAdminCryptoRoutes(app, adminMiddleware, {
      cryptoAdminService: cryptoAdminService as never
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/crypto-lanes"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().lanes).toHaveLength(17);

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/admin/crypto-lanes/CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/readiness"
    });
    expect(readinessResponse.statusCode).toBe(200);

    const authorityResponse = await app.inject({
      method: "GET",
      url: "/admin/crypto-lanes/CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/authority-state"
    });
    expect(authorityResponse.statusCode).toBe(200);
    expect(authorityResponse.json().authorityState.operatorApprovedToOffer).toBe(false);

    const forbiddenResponse = await app.inject({
      method: "POST",
      url: "/admin/crypto-lanes/CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/operator-approval-intent",
      payload: {
        twoFactorToken: "000000",
        reason: "approve"
      }
    });
    expect(forbiddenResponse.statusCode).toBe(403);

    const approvalResponse = await app.inject({
      method: "POST",
      url: "/admin/crypto-lanes/CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/operator-approval-intent",
      payload: {
        twoFactorToken: "123456",
        reason: "approve"
      }
    });
    expect(approvalResponse.statusCode).toBe(200);

    const holdResponse = await app.inject({
      method: "POST",
      url: "/admin/crypto-lanes/CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/hold",
      payload: {
        twoFactorToken: "123456",
        reason: "hold"
      }
    });
    expect(holdResponse.statusCode).toBe(200);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/admin/crypto-lanes/CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT/rollback",
      payload: {
        twoFactorToken: "123456",
        reason: "rollback"
      }
    });
    expect(rollbackResponse.statusCode).toBe(200);
    expect((cryptoAdminService as any).rollbackLane).toHaveBeenCalledWith(
      "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
      "admin-user",
      "rollback"
    );

    delete process.env.ADMIN_2FA_TOKEN;
    await app.close();
  });
});
