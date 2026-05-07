import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "@ethersproject/wallet";
import {
  ExecutionVenueAdapterRegistry,
  LimitlessExecutionAdapter,
  PredictFunExecutionAdapter,
  SignedTradeBundleService,
  TestExecutionAdapter,
  type ExecutableTradeQuote
} from "../src/execution-system/index.js";
import type { UserVenueAccount } from "../src/core/execution/user-venue-accounts.js";

const wallet = new Wallet("0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f");

const quote = (): ExecutableTradeQuote => ({
  quoteId: "exec_quote_test",
  userId: "user-1",
  side: "buy",
  marketId: "canonical-market",
  outcomeId: "YES",
  routeType: "CROSS_VENUE",
  venuePath: ["PREDICT_FUN", "LIMITLESS"],
  executableAmount: "4",
  skippedAmount: "0",
  expectedPrice: 0.42,
  requiredUserSignatureSteps: [
    "PREDICT_FUN user signature required",
    "LIMITLESS user signature required"
  ],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  legs: [
    {
      venue: "PREDICT_FUN",
      venueMarketId: "predict-market",
      venueOutcomeId: "123456789",
      size: "3",
      price: 0.42,
      requiresUserSignature: true
    },
    {
      venue: "LIMITLESS",
      venueMarketId: "limitless-market",
      venueOutcomeId: "limitless-token",
      size: "1",
      price: 0.43,
      requiresUserSignature: true
    }
  ]
});

const account = (venue: UserVenueAccount["venue"]): UserVenueAccount => ({
  venueAccountBindingId: `${venue}-binding`,
  userId: "user-1",
  venue,
  userWalletId: "wallet-1",
  walletAddress: wallet.address,
  venueAccountId: venue === "LIMITLESS" ? "12345" : null,
  venueAccountAddress: wallet.address,
  venueAccountType: venue === "PREDICT_FUN" ? "OAUTH_ACCOUNT" : "EOA",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastVerifiedAt: new Date().toISOString()
});

const predictOrderMetadataClient = {
  async getMarketById() {
    return { chainId: "56", isNegRisk: false, isYieldBearing: false };
  },
  async getMarketStatistics() {
    return { feeRateBps: "0" };
  },
  async getMarketOrderbook() {
    return {
      asks: [[0.42, 10]],
      bids: [[0.41, 10]]
    };
  }
};

const service = () => {
  const registry = new ExecutionVenueAdapterRegistry();
  registry.register(new PredictFunExecutionAdapter({
    executionMode: "user_signed_backend_relay",
    baseUrl: "https://api.predict.fun",
    apiKey: "predict-api-key",
    liveExecutionEnabled: false,
    orderCreatePath: "/v1/orders",
    docsUrl: "https://dev.predict.fun",
    predictOrderMetadataClient
  }));
  registry.register(new LimitlessExecutionAdapter({
    executionMode: "user_signed_backend_relay",
    baseUrl: "https://api.limitless.exchange",
    hmacTokenId: "token-id",
    hmacSecret: "hmac-secret",
    partnerAccountEnabled: true,
    liveExecutionEnabled: false
  }));
  return new SignedTradeBundleService(
    { getQuote: async () => quote() } as never,
    registry,
    { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) }
  );
};

const registryWithPredict = (): ExecutionVenueAdapterRegistry => {
  const registry = new ExecutionVenueAdapterRegistry();
  registry.register(new PredictFunExecutionAdapter({
    executionMode: "user_signed_backend_relay",
    baseUrl: "https://api.predict.fun",
    apiKey: "predict-api-key",
    liveExecutionEnabled: false,
    orderCreatePath: "/v1/orders",
    docsUrl: "https://dev.predict.fun",
    predictOrderMetadataClient
  }));
  return registry;
};

describe("SignedTradeBundleService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepares user-signature requests and dry-run verifies a signed pair bundle", async () => {
    const sut = service();
    const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" });
    expect(prepared.signatureRequests.map((request) => request.venue)).toEqual(["PREDICT_FUN", "LIMITLESS"]);

    const predictRequest = prepared.signatureRequests[0]!;
    const limitlessRequest = prepared.signatureRequests[1]!;
    const predictTypedData = predictRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const predictTypes = { ...predictTypedData.types };
    delete predictTypes.EIP712Domain;
    const predictSignature = await wallet._signTypedData(
      predictTypedData.domain,
      predictTypes,
      predictTypedData.message
    );
    const limitlessTypedData = limitlessRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const limitlessSignature = await wallet._signTypedData(
      limitlessTypedData.domain,
      limitlessTypedData.types,
      limitlessTypedData.message
    );

    const result = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_test",
      dryRun: true,
      signedLegs: [
        {
          legIndex: predictRequest.legIndex,
          venue: predictRequest.venue,
          signedPayload: {
            ...predictRequest.signedPayloadHint,
            signature: predictSignature
          }
        },
        {
          legIndex: limitlessRequest.legIndex,
          venue: limitlessRequest.venue,
          signedPayload: {
            ...limitlessRequest.signedPayloadHint,
            signature: limitlessSignature
          }
        }
      ]
    });

    expect(result.status).toBe("DRY_RUN_VERIFIED");
    expect(result.submittedLegs).toHaveLength(2);
  });

  it("prepares Predict.fun MARKET orders without reserved balance policy", async () => {
    const sut = service();
    const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" });
    const predictRequest = prepared.signatureRequests.find((request) => request.venue === "PREDICT_FUN")!;
    const hint = predictRequest.signedPayloadHint as {
      data?: Record<string, unknown>;
    };

    expect(hint.data?.strategy).toBe("MARKET");
    expect(hint.data).not.toHaveProperty("reservedBalancePolicy");
  });

  it("persists live submit status and refreshes venue fill state after quote submit", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new TestExecutionAdapter("TEST", { fillStatus: "FILLED", fillPrice: 0.51 }));
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      quoteId: "exec_quote_status",
      venuePath: ["TEST"],
      requiredUserSignatureSteps: [],
      legs: [{
        venue: "TEST",
        venueMarketId: "test-market",
        venueOutcomeId: "test-outcome",
        size: "1",
        price: 0.51,
        requiresUserSignature: false
      }]
    };
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") }
    );

    const submitted = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_status",
      dryRun: false,
      signedLegs: []
    });
    expect(submitted.status).toBe("SUBMITTED");

    const status = await sut.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_status"
    });
    expect(status).toMatchObject({
      executionId: "exec_quote_status",
      status: "FILLED",
      submittedLegs: [{
        venue: "TEST",
        status: "FILLED",
        fillState: {
          status: "FILLED",
          filledSize: "1",
          averagePrice: 0.51
        }
      }]
    });
  });

  it("blocks Predict.fun orders below the venue minimum order value", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new PredictFunExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.predict.fun",
      apiKey: "predict-api-key",
      liveExecutionEnabled: false,
      orderCreatePath: "/v1/orders",
      docsUrl: "https://dev.predict.fun"
    }));
    const lowValueQuote = quote();
    lowValueQuote.venuePath = ["PREDICT_FUN"];
    lowValueQuote.legs = [{
      venue: "PREDICT_FUN",
      venueMarketId: "predict-market",
      venueOutcomeId: "123456789",
      size: "2",
      price: 0.4,
      requiresUserSignature: true
    }];
    const sut = new SignedTradeBundleService(
      { getQuote: async () => lowValueQuote } as never,
      registry,
      { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) }
    );

    await expect(sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" }))
      .rejects.toMatchObject({
        code: "PREDICT_FUN_ORDER_VALUE_TOO_LOW",
        message: "Predict.fun order value must be at least 0.9 USD. Increase amount to at least 2.25."
      });
  });

  it("blocks Predict.fun orders without a numeric venue token id", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new PredictFunExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.predict.fun",
      apiKey: "predict-api-key",
      liveExecutionEnabled: false,
      orderCreatePath: "/v1/orders",
      docsUrl: "https://dev.predict.fun"
    }));
    const invalidTokenQuote = quote();
    invalidTokenQuote.venuePath = ["PREDICT_FUN"];
    invalidTokenQuote.legs = [{
      venue: "PREDICT_FUN",
      venueMarketId: "predict-market",
      venueOutcomeId: "NO",
      size: "3",
      price: 0.42,
      requiresUserSignature: true
    }];
    const sut = new SignedTradeBundleService(
      { getQuote: async () => invalidTokenQuote } as never,
      registry,
      { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) }
    );

    await expect(sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" }))
      .rejects.toMatchObject({
        code: "PREDICT_FUN_TOKEN_ID_INVALID"
      });
  });

  it("reports Predict.fun live readiness blocked when allowance is below the bid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, input: RequestInit) => {
      const body = JSON.parse(String(input.body)) as { params: Array<{ data: string }> };
      const data = body.params[0]?.data ?? "";
      const isAllowance = data.startsWith("0xdd62ed3e");
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: isAllowance ? "0x0" : "0xde0b6b3a7640000"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => quote() } as never,
      registryWithPredict(),
      { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {
        PREDICT_FUN_BALANCE_PREFLIGHT_RPC_URL: "https://bsc-rpc.example",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_DECIMALS: "18"
      } as NodeJS.ProcessEnv
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_test" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("PREDICT_FUN: Predict.fun collateral USDT allowance is less than the total bid amount.");
    expect(readiness.venues.find((venue) => venue.venue === "PREDICT_FUN")?.collateral).toMatchObject({
      balance: "1",
      allowance: "0",
      requiredNotional: "1.26"
    });
  });

  it("blocks live submit before venue calls when Predict.fun readiness is stale", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("rpc unavailable");
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => quote() } as never,
      registryWithPredict(),
      { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv
    );

    await expect(sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_test",
      dryRun: false,
      signedLegs: []
    })).rejects.toMatchObject({
      code: "LIVE_SUBMIT_READINESS_BLOCKED"
    });
  });

  it("reports Predict.fun live readiness fresh when balance and allowance cover the bid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x1bc16d674ec80000"
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => quote() } as never,
      registryWithPredict(),
      { getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]) },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {
        PREDICT_FUN_BALANCE_PREFLIGHT_RPC_URL: "https://bsc-rpc.example",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        PREDICT_FUN_BALANCE_ACTIVATION_TOKEN_DECIMALS: "18"
      } as NodeJS.ProcessEnv
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_test" });

    expect(readiness.status).toBe("fresh");
    expect(readiness.blockers).toEqual([]);
  });

  it("rejects a Limitless signature from the wrong signer", async () => {
    const sut = service();
    const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" });
    const predictRequest = prepared.signatureRequests.find((request) => request.venue === "PREDICT_FUN")!;
    const limitlessRequest = prepared.signatureRequests.find((request) => request.venue === "LIMITLESS")!;
    const predictTypedData = predictRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const predictTypes = { ...predictTypedData.types };
    delete predictTypes.EIP712Domain;
    const predictSignature = await wallet._signTypedData(
      predictTypedData.domain,
      predictTypes,
      predictTypedData.message
    );
    const wrongWallet = Wallet.createRandom();
    const typedData = limitlessRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const signature = await wrongWallet._signTypedData(typedData.domain, typedData.types, typedData.message);

    await expect(sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_test",
      dryRun: true,
      signedLegs: [
        {
          legIndex: predictRequest.legIndex,
          venue: predictRequest.venue,
          signedPayload: {
            ...predictRequest.signedPayloadHint,
            signature: predictSignature
          }
        },
        {
          legIndex: limitlessRequest.legIndex,
          venue: limitlessRequest.venue,
          signedPayload: {
            ...limitlessRequest.signedPayloadHint,
            signature
          }
        }
      ]
    })).rejects.toMatchObject({ code: "SIGNED_TRADE_SIGNATURE_MISMATCH" });
  });
});
