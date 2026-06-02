import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerFundingRoutes, type FundingRouteHandlers } from "../src/api/routes/funding.js";
import type { FundingIntentView, VenueBalanceView, WithdrawalIntentView } from "../src/core/funding/types.js";
import type { RateLimiter, RateLimitInput, RateLimitResult } from "../src/api/rate-limiter.js";

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

class FakeRateLimiter implements RateLimiter {
  public readonly consumed: RateLimitInput[] = [];

  public constructor(private readonly result: RateLimitResult = { allowed: true }) {}

  public async consume(input: RateLimitInput): Promise<RateLimitResult> {
    this.consumed.push(input);
    return this.result;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

const buildApp = async (options: {
  rateLimiter?: RateLimiter;
  listVenueBalances?: FundingRouteHandlers["listVenueBalances"];
  listVenueActivations?: FundingRouteHandlers["listVenueActivations"];
} = {}) => {
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
    listVenueBalances: options.listVenueBalances ?? (async () => ([{
      venue: "POLYMARKET",
      token: "USDC",
      readyAmount: "100",
      pendingWithdrawalAmount: "0",
      availableAmount: "100",
      updatedAt: "2026-04-25T00:00:00.000Z"
    }])),
    listVenueActivations: options.listVenueActivations ?? (async () => ([{
      venue: "POLYMARKET",
      activationRequired: true,
      mode: "VENUE_UI_OR_RELAYER",
      status: "CONFIG_REQUIRED",
      tokenSymbol: "pUSD",
      tokenAddress: null,
      chainId: null,
      ownerAddress: "0x1111111111111111111111111111111111111111",
      signerAddress: "0x2222222222222222222222222222222222222222",
      spenderAddress: null,
      amount: null,
      transactionRequest: null,
      instructions: ["Use the official venue activation flow."],
      blockers: ["POLYMARKET activation transaction is not configured for backend-safe preparation."]
    }, {
      venue: "PREDICT_FUN",
      activationRequired: false,
      mode: "NOT_REQUIRED",
      status: "NOT_REQUIRED",
      tokenSymbol: "USDT",
      tokenAddress: null,
      chainId: null,
      ownerAddress: "0x2222222222222222222222222222222222222222",
      signerAddress: "0x2222222222222222222222222222222222222222",
      spenderAddress: null,
      amount: null,
      transactionRequest: null,
      instructions: ["Predict.fun does not require a separate balance activation step."],
      blockers: []
    }])),
    preparePolymarketActivation: async () => ({
      ownerAddress: "0x2222222222222222222222222222222222222222",
      depositWalletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 137,
      nonce: "1",
      deadline: "1770000000",
      calls: [{
        target: "0x3333333333333333333333333333333333333333",
        value: "0",
        data: "0x095ea7b3"
      }],
      typedData: {
        domain: {
          name: "DepositWallet",
          version: "1",
          chainId: 137,
          verifyingContract: "0x1111111111111111111111111111111111111111"
        },
        types: {
          Call: [
            { name: "target", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" }
          ],
          Batch: [
            { name: "wallet", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "calls", type: "Call[]" }
          ]
        },
        primaryType: "Batch",
        message: {
          wallet: "0x1111111111111111111111111111111111111111",
          nonce: "1",
          deadline: "1770000000",
          calls: [{
            target: "0x3333333333333333333333333333333333333333",
            value: "0",
            data: "0x095ea7b3"
          }]
        }
      },
      wrapsUsdc: false,
      usdcBalance: "0",
      pUsdBalance: "1000000",
      approvalSpenders: ["0x3333333333333333333333333333333333333333"],
      instructions: ["Sign once."]
    }),
    submitPolymarketActivation: async () => ({
      relayerTransactionId: "relay-1",
      relayerState: "STATE_NEW",
      transactionHash: null
    }),
    preparePolymarketClobSync: async () => ({
      signer: "0x2222222222222222222222222222222222222222",
      account: "0x1111111111111111111111111111111111111111",
      expiresAt: "2026-04-25T00:01:00.000Z",
      typedData: {
        domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" }
          ],
          ClobAuth: [
            { name: "address", type: "address" },
            { name: "timestamp", type: "string" },
            { name: "nonce", type: "uint256" },
            { name: "message", type: "string" }
          ]
        },
        primaryType: "ClobAuth",
        message: {
          address: "0x2222222222222222222222222222222222222222",
          timestamp: "1770000000",
          nonce: 0,
          message: "This message attests that I control the given wallet"
        }
      },
      signedPayloadHint: {
        purpose: "POLYMARKET_CLOB_AUTH",
        signer: "0x2222222222222222222222222222222222222222",
        account: "0x1111111111111111111111111111111111111111",
        data: {
          address: "0x2222222222222222222222222222222222222222",
          timestamp: 1770000000,
          nonce: 0,
          chainId: 137,
          funderAddress: "0x1111111111111111111111111111111111111111"
        }
      }
    }),
    submitPolymarketClobSync: async () => ({
      status: "READY",
      readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED",
      clobCollateralBalance: "100",
      clobCollateralAllowance: "100",
      readyAmount: "100",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      signerAddress: "0x2222222222222222222222222222222222222222",
      clobAllowanceSpenders: []
    }),
    listFundingHistory: async (_userId, input) => ({
      items: [{
        id: "funding:funding-1:leg-1",
        direction: "FUNDING",
        intentId: "funding-1",
        routeLegId: "leg-1",
        venue: "POLYMARKET",
        token: "USDC",
        amount: "100",
        sourceChain: "SOLANA",
        destinationChain: "POLYGON",
        status: "LEG_READY_TO_TRADE",
        aggregateStatus: "READY_TO_TRADE",
        legStatus: "LEG_READY_TO_TRADE",
        txHashes: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        readyToTrade: true,
        completed: null,
        destinationReceived: true,
        venueConfirmed: true,
        checkedAt: "2026-04-25T00:05:00.000Z",
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:05:00.000Z"
      }],
      page: input?.page ?? 1,
      pageSize: input?.pageSize ?? input?.limit ?? 5,
      totalItems: 12,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false
    }),
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
  }, {
    intentCreateRateLimiter: options.rateLimiter
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

  it("rate limits funding and withdrawal intent creation without blocking reads", async () => {
    const rateLimiter = new FakeRateLimiter({ allowed: false, reason: "USER_LIMIT" });
    const app = await buildApp({ rateLimiter });
    const token = app.jwt.sign({ userId: "user-1", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    const funding = await app.inject({
      method: "POST",
      url: "/funding/intents",
      headers,
      payload: {
        sourceChain: "SOLANA",
        sourceToken: "USDC",
        sourceAmount: "100",
        sourceWalletAddress: "wallet",
        idempotencyKey: "idem",
        targets: [{ targetVenue: "POLYMARKET", targetPercentage: 100 }]
      }
    });
    expect(funding.statusCode).toBe(429);
    expect(funding.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(rateLimiter.consumed[0]).toMatchObject({ scope: "funding_intent_create", userId: "user-1" });

    const withdrawal = await app.inject({
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
    expect(withdrawal.statusCode).toBe(429);
    expect(rateLimiter.consumed[1]).toMatchObject({ scope: "withdrawal_intent_create", userId: "user-1" });

    const history = await app.inject({ method: "GET", url: "/funding/history", headers });
    expect(history.statusCode).toBe(200);
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
    const activations = await app.inject({ method: "GET", url: "/funding/venue-activations", headers });
    expect(activations.statusCode).toBe(200);
    expect(activations.json()).toMatchObject({
      activations: [
        { venue: "POLYMARKET", activationRequired: true, mode: "VENUE_UI_OR_RELAYER" },
        { venue: "PREDICT_FUN", activationRequired: false, mode: "NOT_REQUIRED" }
      ]
    });
    expect(activations.body).not.toContain("privateKey");
    expect(activations.body).not.toContain("secret");

    const preparedActivation = await app.inject({
      method: "POST",
      url: "/funding/venue-activations/polymarket/prepare",
      headers,
      payload: {}
    });
    expect(preparedActivation.statusCode).toBe(200);
    expect(preparedActivation.json()).toMatchObject({
      activation: {
        ownerAddress: "0x2222222222222222222222222222222222222222",
        depositWalletAddress: "0x1111111111111111111111111111111111111111",
        typedData: { primaryType: "Batch" }
      }
    });
    expect(preparedActivation.body).not.toContain("secret");

    const submittedActivation = await app.inject({
      method: "POST",
      url: "/funding/venue-activations/polymarket/submit",
      headers,
      payload: {
        ownerAddress: "0x2222222222222222222222222222222222222222",
        depositWalletAddress: "0x1111111111111111111111111111111111111111",
        nonce: "1",
        deadline: "1770000000",
        calls: [{
          target: "0x3333333333333333333333333333333333333333",
          value: "0",
          data: "0x095ea7b3"
        }],
        signature: `0x${"1".repeat(130)}`
      }
    });
    expect(submittedActivation.statusCode).toBe(202);
    expect(submittedActivation.json()).toMatchObject({
      activation: {
        relayerTransactionId: "relay-1",
        relayerState: "STATE_NEW"
      }
    });
    expect(submittedActivation.body).not.toContain("signature");

    const preparedClobSync = await app.inject({
      method: "POST",
      url: "/funding/venue-activations/polymarket/clob-sync/prepare",
      headers,
      payload: {}
    });
    expect(preparedClobSync.statusCode).toBe(200);
    expect(preparedClobSync.json()).toMatchObject({
      sync: {
        signer: "0x2222222222222222222222222222222222222222",
        account: "0x1111111111111111111111111111111111111111",
        typedData: { primaryType: "ClobAuth" }
      }
    });
    expect(preparedClobSync.body).not.toContain("secret");

    const submittedClobSync = await app.inject({
      method: "POST",
      url: "/funding/venue-activations/polymarket/clob-sync/submit",
      headers,
      payload: {
        signedPayload: {
          signer: "0x2222222222222222222222222222222222222222",
          account: "0x1111111111111111111111111111111111111111",
          signature: `0x${"1".repeat(130)}`,
          typedData: preparedClobSync.json().sync.typedData,
          data: preparedClobSync.json().sync.signedPayloadHint.data
        }
      }
    });
    expect(submittedClobSync.statusCode).toBe(202);
    expect(submittedClobSync.json()).toMatchObject({
      sync: {
        status: "READY",
        readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED",
        readyAmount: "100"
      }
    });
    expect(submittedClobSync.body).not.toContain("signature");

    const history = await app.inject({ method: "GET", url: "/funding/history?page=1&pageSize=5", headers });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      refreshAfterSeconds: 10,
      page: 1,
      pageSize: 5,
      totalItems: 12,
      totalPages: 3,
      hasNextPage: true,
      items: [{
        direction: "FUNDING",
        intentId: "funding-1",
        venue: "POLYMARKET",
        readyToTrade: true
      }]
    });
    expect(history.body).not.toContain("privateKey");
    expect(history.body).not.toContain("providerWalletAccountId");

    const fundingReceipt = await app.inject({ method: "GET", url: "/funding/intents/funding-1/receipt", headers });
    expect(fundingReceipt.statusCode).toBe(200);
    expect(fundingReceipt.json()).toMatchObject({
      receipt: {
        fundingIntentId: "funding-1",
        currentStatus: "BRIDGING",
        sourceChain: "SOLANA",
        userSafeMessage: "Funding intent created. Route quote is pending."
      }
    });
    expect(fundingReceipt.body).not.toContain("providerStatus");
    expect(fundingReceipt.body).not.toContain("privateKey");

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
    const withdrawalReceipt = await app.inject({ method: "GET", url: "/funding/withdrawals/withdrawal-1/receipt", headers });
    expect(withdrawalReceipt.statusCode).toBe(200);
    expect(withdrawalReceipt.json()).toMatchObject({
      receipt: {
        withdrawalIntentId: "withdrawal-1",
        currentStatus: "WITHDRAWAL_CREATED",
        destinationChain: "POLYGON",
        userSafeMessage: "Withdrawal intent created. Route preview is pending."
      }
    });
    expect(withdrawalReceipt.body).not.toContain("providerStatus");
    expect(withdrawalReceipt.body).not.toContain("privateKey");
    expect(created.body).not.toContain("secret");
    expect(created.body).not.toContain("transactionRequest");
    await app.close();
  });

  it("coalesces concurrent venue balance refreshes for the same user", async () => {
    let calls = 0;
    let resolveBalances!: (value: VenueBalanceView[]) => void;
    const pendingBalances = new Promise<VenueBalanceView[]>((resolve) => {
      resolveBalances = resolve;
    });
    const app = await buildApp({
      listVenueBalances: async () => {
        calls += 1;
        return pendingBalances;
      }
    });
    const token = app.jwt.sign({ userId: "funding-cache-user", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    const first = app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    const second = app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    resolveBalances([{
      venue: "POLYMARKET",
      token: "USDC",
      readyAmount: "100",
      pendingWithdrawalAmount: "0",
      availableAmount: "100",
      updatedAt: "2026-04-25T00:00:00.000Z"
    }]);

    const responses = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toMatchObject({ balances: [{ venue: "POLYMARKET", availableAmount: "100" }] });
    expect(responses[1].json()).toMatchObject({ balances: [{ venue: "POLYMARKET", availableAmount: "100" }] });
    await app.close();
  });

  it("serves last-good venue balances when a transient refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    let fail = false;
    const app = await buildApp({
      listVenueBalances: async () => {
        if (fail) {
          throw new Error("database pool timeout");
        }
        return [{
          venue: "POLYMARKET",
          token: "USDC",
          readyAmount: "100",
          pendingWithdrawalAmount: "0",
          availableAmount: "100",
          updatedAt: "2026-04-25T00:00:00.000Z"
        }];
      }
    });
    const token = app.jwt.sign({ userId: "funding-stale-user", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    const fresh = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json()).toMatchObject({
      balances: [{ venue: "POLYMARKET", availableAmount: "100" }],
      cache: "miss"
    });

    fail = true;
    vi.setSystemTime(new Date("2026-04-25T00:00:11.000Z"));
    const stale = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({
      balances: [{ venue: "POLYMARKET", availableAmount: "100" }],
      cache: "stale"
    });
    await app.close();
  });

  it("invalidates venue balance cache after Polymarket CLOB sync succeeds", async () => {
    let calls = 0;
    const app = await buildApp({
      listVenueBalances: async () => {
        calls += 1;
        return [{
          venue: "POLYMARKET",
          token: "USDC",
          readyAmount: calls === 1 ? "0" : "100",
          pendingWithdrawalAmount: "0",
          availableAmount: calls === 1 ? "0" : "100",
          updatedAt: "2026-04-25T00:00:00.000Z"
        }];
      }
    });
    const token = app.jwt.sign({ userId: "funding-clob-sync-user", role: "USER" });
    const headers = { authorization: `Bearer ${token}` };

    const beforeSync = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    expect(beforeSync.statusCode).toBe(200);
    expect(beforeSync.json()).toMatchObject({
      balances: [{ venue: "POLYMARKET", availableAmount: "0" }],
      cache: "miss"
    });

    const sync = await app.inject({
      method: "POST",
      url: "/funding/venue-activations/polymarket/clob-sync/submit",
      headers,
      payload: {
        signedPayload: {
          signer: "0x2222222222222222222222222222222222222222",
          account: "0x1111111111111111111111111111111111111111",
          signature: `0x${"1".repeat(130)}`,
          typedData: { primaryType: "ClobAuth" },
          data: { address: "0x2222222222222222222222222222222222222222" }
        }
      }
    });
    expect(sync.statusCode).toBe(202);

    const afterSync = await app.inject({ method: "GET", url: "/funding/venue-balances", headers });
    expect(afterSync.statusCode).toBe(200);
    expect(calls).toBe(2);
    expect(afterSync.json()).toMatchObject({
      balances: [{ venue: "POLYMARKET", availableAmount: "100" }],
      cache: "miss"
    });
    await app.close();
  });
});
