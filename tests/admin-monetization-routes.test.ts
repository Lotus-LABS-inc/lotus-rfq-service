import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it } from "vitest";
import { registerAdminMonetizationRoutes } from "../src/api/admin/monetization.routes.js";
import type { MonetizationRepository } from "../src/repositories/monetization.repository.js";

const adminMiddleware: preHandlerHookHandler = async (request) => {
  request.user = { userId: "admin-1", role: "ADMIN" };
};

const repository = {
  async getSummary() {
    return [
      {
        venue: "POLYMARKET",
        lane: "CRYPTO_BTC",
        capture_mode: "SHADOW_PLUS_BUILDER_FEE",
        revenue_source: "POLYMARKET_BUILDER_FEE",
        policy_version: "lotus-fees-v1",
        currency: "USDC",
        row_count: 1,
        actual_builder_fees_collected: "1.25",
        shadow_improvement_fees: "0",
        uncollected_improvement_opportunity: "0",
        ledger_amount: "1.25"
      },
      {
        venue: "LIMITLESS",
        lane: "CRYPTO_BTC",
        capture_mode: "SHADOW",
        revenue_source: "SHADOW_PRICE_IMPROVEMENT",
        policy_version: "lotus-fees-v1",
        currency: "USDC",
        row_count: 1,
        actual_builder_fees_collected: "0",
        shadow_improvement_fees: "4",
        uncollected_improvement_opportunity: "4",
        ledger_amount: "4"
      }
    ];
  },
  async listLedgerEntries() {
    return [
      {
        id: "ledger-1",
        idempotency_key: "secret-free-key",
        execution_id: null,
        rfq_id: "rfq-1",
        quote_id: "quote-1",
        user_id: "user-1",
        venue: "POLYMARKET",
        lane_id: "CRYPTO_BTC",
        fee_policy_version: "lotus-fees-v1",
        fee_type: "BUILDER_FEE",
        status: "COLLECTED_BUILDER_FEE",
        amount: "1.25",
        currency: "USDC",
        capture_mode: "SHADOW_PLUS_BUILDER_FEE",
        revenue_source: "POLYMARKET_BUILDER_FEE",
        actual_builder_fee_collected: "1.25",
        shadow_improvement_fee: "0",
        uncollected_improvement_opportunity: "0",
        settlement_status: "SETTLEMENT_VERIFIED",
        source_event_id: "match-1",
        metadata: { label: "Lotus builder fee collected by venue where supported." },
        created_at: new Date("2026-04-29T00:00:00.000Z")
      }
    ];
  },
  async listPolicies() {
    return [];
  }
} as unknown as MonetizationRepository;

describe("admin monetization routes", () => {
  it("separates collected builder fees from shadow opportunity", async () => {
    const app = Fastify({ logger: false });
    await registerAdminMonetizationRoutes(app, adminMiddleware, { monetizationRepository: repository });

    const response = await app.inject({ method: "GET", url: "/admin/monetization/summary" });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary.totals).toMatchObject({
      actualBuilderFeesCollected: "1.25",
      shadowImprovementFees: "4",
      uncollectedImprovementOpportunity: "4"
    });
    expect(response.body).not.toContain("API_SECRET");
    expect(response.body).not.toContain("privateKey");
    await app.close();
  });

  it("returns frontend-safe ledger rows", async () => {
    const app = Fastify({ logger: false });
    await registerAdminMonetizationRoutes(app, adminMiddleware, { monetizationRepository: repository });
    const response = await app.inject({ method: "GET", url: "/admin/monetization/ledger?venue=POLYMARKET" });
    expect(response.statusCode).toBe(200);
    expect(response.json().ledger[0]).toMatchObject({
      revenueSource: "POLYMARKET_BUILDER_FEE",
      actualBuilderFeeCollected: "1.25",
      uncollectedImprovementOpportunity: "0"
    });
    await app.close();
  });
});
