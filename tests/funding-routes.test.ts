import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";

import { registerFundingRoutes } from "../src/api/routes/funding.js";
import type { FundingIntentView, WithdrawalIntentView } from "../src/core/funding/types.js";

const view = (userId = "user-1"): FundingIntentView => ({
  intent: {
    fundingIntentId: "funding-1",
    userId,
    sourceChain: "SOLANA",
    sourceToken: "USDC",
    sourceAmount: "100",
    sourceWalletAddress: "wallet",
    status: "INTENT_CREATED",
    idempotencyKey: "idem",
    aggregateRouteQuote: {},
    totalEstimatedFees: "0",
    totalEstimatedTimeSeconds: null,
    auditEventIds: [],
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z"
  },
  targets: [],
  routeLegs: [],
  reconciliations: [],
  userSafeMessage: "Funding intent created. Route quote is pending."
});

const withdrawalView = (userId = "user-1"): WithdrawalIntentView => ({
  intent: {
    withdrawalIntentId: "withdrawal-1",
    userId,
    token: "USDC",
    amount: "100",
    destinationChain: "POLYGON",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    status: "WITHDRAWAL_CREATED",
    idempotencyKey: "withdraw-idem",
    aggregateRouteQuote: {},
    totalEstimatedFees: "0",
    totalEstimatedTimeSeconds: null,
    auditEventIds: [],
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-25T00:00:00.000Z"
  },
  sources: [],
  routeLegs: [],
  reconciliations: [],
  userSafeMessage: "Withdrawal intent created. Route preview is pending."
});

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  const auth = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ code: "UNAUTHORIZED" });
    }
  };
  await registerFundingRoutes(app, auth, {
    createIntent: async (userId) => view(userId),
    getIntent: async (userId) => view(userId),
    quoteIntent: async (userId) => ({
      ...view(userId),
      intent: { ...view(userId).intent, status: "USER_SIGNATURE_REQUIRED" }
    }),
    submitRouteLeg: async (userId) => ({
      ...view(userId),
      intent: { ...view(userId).intent, status: "BRIDGING" }
    }),
    refreshIntentStatus: async (userId) => ({
      ...view(userId),
      intent: { ...view(userId).intent, status: "BRIDGING" }
    }),
    listVenueCapabilities: async () => ([{
      venue: "POLYMARKET",
      readinessStatus: "READY",
      depositAddressConfigured: true,
      notes: "safe"
    }]),
    listVenueBalances: async () => ([{
      venue: "POLYMARKET",
      token: "USDC",
      readyAmount: "100",
      pendingWithdrawalAmount: "0",
      availableAmount: "100",
      updatedAt: "2026-04-25T00:00:00.000Z"
    }]),
    createWithdrawalIntent: async (userId) => withdrawalView(userId),
    getWithdrawalIntent: async (userId) => withdrawalView(userId),
    quoteWithdrawalIntent: async (userId) => ({
      ...withdrawalView(userId),
      intent: {
        ...withdrawalView(userId).intent,
        status: "USER_SIGNATURE_REQUIRED",
        aggregateRouteQuote: {
          provider: "LOTUS_WITHDRAWAL_V0",
          polymarketBridge: {
            provider: "POLYMARKET_BRIDGE",
            mode: "SANDBOX_DRY_RUN",
            bridgeAddressPresent: true,
            completionPersisted: false
          }
        }
      }
    }),
    submitWithdrawalRouteLeg: async (userId) => ({
      ...withdrawalView(userId),
      intent: { ...withdrawalView(userId).intent, status: "WITHDRAWING" }
    }),
    refreshWithdrawalStatus: async (userId) => ({
      ...withdrawalView(userId),
      intent: { ...withdrawalView(userId).intent, status: "WITHDRAWING" }
    })
  });
  return app;
};

describe("Funding routes", () => {
  it("requires auth and creates frontend-safe funding intents", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const unauthorized = await app.inject({
      method: "POST",
      url: "/funding/intents",
      payload: {}
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: "POST",
      url: "/funding/intents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceChain: "SOLANA",
        sourceToken: "USDC",
        sourceAmount: "100",
        sourceWalletAddress: "wallet",
        idempotencyKey: "idem",
        targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      fundingIntentId: "funding-1",
      currentStatus: "INTENT_CREATED",
      userSafeMessage: "Funding intent created. Route quote is pending."
    });
    expect(response.body).not.toContain("LIFI_API_KEY");
    await app.close();
  });

  it("exposes quote, submit, status, and capability surfaces", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    await expect(app.inject({ method: "POST", url: "/funding/intents/funding-1/quote", headers }))
      .resolves.toMatchObject({ statusCode: 200 });
    await expect(app.inject({
      method: "POST",
      url: "/funding/intents/funding-1/submit",
      headers,
      payload: { routeLegId: "leg-1", txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    })).resolves.toMatchObject({ statusCode: 202 });
    await expect(app.inject({ method: "GET", url: "/funding/intents/funding-1/status", headers }))
      .resolves.toMatchObject({ statusCode: 200 });
    const capabilities = await app.inject({ method: "GET", url: "/funding/venues/capabilities", headers });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.body).not.toContain("secret");
    await app.close();
  });

  it("exposes frontend-safe withdrawal and venue balance surfaces", async () => {
    const app = await buildApp();
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    const balances = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    expect(balances.statusCode).toBe(200);
    expect(balances.json()).toMatchObject({
      balances: [{ venue: "POLYMARKET", token: "USDC", availableAmount: "100" }]
    });

    const created = await app.inject({
      method: "POST",
      url: "/funding/withdrawals",
      headers,
      payload: {
        token: "USDC",
        amount: "100",
        destinationChain: "POLYGON",
        destinationWalletAddress: "0x1111111111111111111111111111111111111111",
        idempotencyKey: "withdraw-idem",
        sources: [{ sourceVenue: "POLYMARKET", sourcePercentage: 100 }]
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      withdrawalIntentId: "withdrawal-1",
      currentStatus: "WITHDRAWAL_CREATED",
      userSafeMessage: "Withdrawal intent created. Route preview is pending."
    });

    await expect(app.inject({ method: "GET", url: "/funding/withdrawals/withdrawal-1", headers }))
      .resolves.toMatchObject({ statusCode: 200 });
    const quote = await app.inject({ method: "POST", url: "/funding/withdrawals/withdrawal-1/quote", headers });
    expect(quote.statusCode).toBe(200);
    expect(quote.json()).toMatchObject({
      routePreview: {
        polymarketBridge: {
          provider: "POLYMARKET_BRIDGE",
          mode: "SANDBOX_DRY_RUN",
          completionPersisted: false
        }
      }
    });
    expect(quote.body).not.toContain("authorization");
    expect(quote.body).not.toContain("privateKey");
    await expect(app.inject({
      method: "POST",
      url: "/funding/withdrawals/withdrawal-1/submit",
      headers,
      payload: {
        withdrawalRouteLegId: "withdrawal-leg-1",
        txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    })).resolves.toMatchObject({ statusCode: 202 });
    await expect(app.inject({ method: "GET", url: "/funding/withdrawals/withdrawal-1/status", headers }))
      .resolves.toMatchObject({ statusCode: 200 });
    expect(created.body).not.toContain("secret");
    expect(created.body).not.toContain("transactionRequest");
    await app.close();
  });
});
