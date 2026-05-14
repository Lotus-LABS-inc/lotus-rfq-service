import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "@ethersproject/wallet";
import {
  ExecutionVenueAdapterRegistry,
  LimitlessExecutionAdapter,
  PredictFunExecutionAdapter,
  SignedTradeBundleService,
  TestExecutionAdapter,
  type ExecutableTradeQuote,
  type PreparedVenueOrder,
  type VenueFillState,
  type VenueSubmitResult
} from "../src/execution-system/index.js";
import type { UserVenueAccount } from "../src/core/execution/user-venue-accounts.js";
import type {
  SignedTradeExecutionStatus,
  SignedTradeExecutionStatusRepository,
  SignedTradePositionRecorder
} from "../src/execution-system/signed-trade-bundle.js";

const wallet = new Wallet("0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f");
const limitlessMarketExchange = "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47";

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
      venueOutcomeId: "987654321",
      size: "1",
      price: 0.43,
      metadata: {
        limitlessExchangeAddress: limitlessMarketExchange
      },
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

class MemorySignedTradeStatusRepository implements SignedTradeExecutionStatusRepository {
  public readonly rows = new Map<string, SignedTradeExecutionStatus>();

  public async saveExecutionStatus(status: SignedTradeExecutionStatus): Promise<void> {
    this.rows.set(`${status.userId}:${status.executionId}`, structuredClone(status));
  }

  public async findExecutionStatus(input: { userId: string; executionId: string }): Promise<SignedTradeExecutionStatus | null> {
    return structuredClone(this.rows.get(`${input.userId}:${input.executionId}`) ?? null);
  }
}

class MemorySignedTradePositionRecorder implements SignedTradePositionRecorder {
  public readonly applications = new Map<string, Parameters<SignedTradePositionRecorder["recordFilledLeg"]>[0]>();

  public async recordFilledLeg(input: Parameters<SignedTradePositionRecorder["recordFilledLeg"]>[0]): Promise<void> {
    this.applications.set(
      `${input.executionId}:${input.userId}:${input.legIndex}:${input.venueOrderId}`,
      structuredClone(input)
    );
  }
}

class FilledRouteSizeAdapter extends TestExecutionAdapter {
  public readonly venue = "TEST";

  public async submitOrder(_order?: PreparedVenueOrder): Promise<VenueSubmitResult> {
    return {
      venueOrderId: "test-order-route-size",
      status: "FILLED",
      filledSize: "0.8",
      averagePrice: 0
    };
  }

  public async fetchFillState(): Promise<VenueFillState> {
    return {
      status: "FILLED",
      filledSize: "80",
      averagePrice: 0.01,
      offchainFilled: true
    };
  }
}

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

const limitlessOnlyQuote = (): ExecutableTradeQuote => ({
  ...quote(),
  venuePath: ["LIMITLESS"],
  executableAmount: "1",
  expectedPrice: 0.43,
  requiredUserSignatureSteps: ["LIMITLESS user signature required"],
  legs: [
    {
      venue: "LIMITLESS",
      venueMarketId: "limitless-market",
      venueOutcomeId: "987654321",
      size: "1",
      price: 0.43,
      metadata: {
        limitlessExchangeAddress: limitlessMarketExchange
      },
      requiresUserSignature: true
    }
  ]
});

const registryWithLimitless = (liveExecutionEnabled = false): ExecutionVenueAdapterRegistry => {
  const registry = new ExecutionVenueAdapterRegistry();
  registry.register(new LimitlessExecutionAdapter({
    executionMode: "user_signed_backend_relay",
    baseUrl: "https://api.limitless.exchange",
    hmacTokenId: "token-id",
    hmacSecret: "hmac-secret",
    partnerAccountEnabled: true,
    liveExecutionEnabled
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
      predictTypes as never,
      predictTypedData.message
    );
    const limitlessTypedData = limitlessRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const limitlessSignature = await wallet._signTypedData(
      limitlessTypedData.domain,
      limitlessTypedData.types as never,
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

  it("blocks Limitless signature preparation when the linked profile id is not relay-ready", async () => {
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
    const invalidLimitlessAccount = {
      ...account("LIMITLESS"),
      venueAccountId: wallet.address
    };
    const sut = new SignedTradeBundleService(
      { getQuote: async () => quote() } as never,
      registry,
      { getAccount: async (_userId, venue) => venue.toUpperCase() === "LIMITLESS" ? invalidLimitlessAccount : account("PREDICT_FUN") }
    );

    await expect(sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" })).rejects.toMatchObject({
      code: "LIMITLESS_PROFILE_SETUP_REQUIRED"
    });
  });

  it("rounds Limitless signature order size down to venue precision", async () => {
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      legs: quote().legs.map((leg) => leg.venue === "LIMITLESS"
        ? { ...leg, size: "14.20454545" }
        : leg)
    };
    const registry = registryWithPredict();
    registry.register(new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      hmacTokenId: "token-id",
      hmacSecret: "hmac-secret",
      partnerAccountEnabled: true,
      liveExecutionEnabled: false
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async (_userId, venue) => account(venue as UserVenueAccount["venue"]) }
    );

    const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" });
    const limitlessRequest = prepared.signatureRequests.find((request) => request.venue === "LIMITLESS")!;
    const order = ((limitlessRequest.signedPayloadHint as Record<string, unknown>).data as Record<string, unknown>).order as Record<string, unknown>;

    expect(Number(order.price)).toBe(0.43);
    expect(Number(order.takerAmount) / 1_000_000).toBeCloseTo(14.204, 6);
  });

  it("signs Limitless orders against the market venue exchange address", async () => {
    const marketExchange = "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47";
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      legs: quote().legs.map((leg) => leg.venue === "LIMITLESS"
        ? { ...leg, metadata: { limitlessExchangeAddress: marketExchange } }
        : leg)
    };
    const registry = registryWithPredict();
    registry.register(new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      hmacTokenId: "token-id",
      hmacSecret: "hmac-secret",
      partnerAccountEnabled: true,
      liveExecutionEnabled: false
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async (_userId, venue) => account(venue as UserVenueAccount["venue"]) }
    );

    const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" });
    const limitlessRequest = prepared.signatureRequests.find((request) => request.venue === "LIMITLESS")!;

    expect((limitlessRequest.typedData as { domain: { verifyingContract: string } }).domain.verifyingContract).toBe(marketExchange.toLowerCase());
  });

  it("blocks Limitless signing when the market exchange address is missing", async () => {
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      legs: quote().legs.map((leg) => leg.venue === "LIMITLESS"
        ? { ...leg, metadata: undefined }
        : leg)
    };
    const registry = registryWithPredict();
    registry.register(new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      hmacTokenId: "token-id",
      hmacSecret: "hmac-secret",
      partnerAccountEnabled: true,
      liveExecutionEnabled: false
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async (_userId, venue) => account(venue as UserVenueAccount["venue"]) }
    );

    await expect(sut.prepare({ userId: "user-1", quoteId: "exec_quote_test" }))
      .rejects.toMatchObject({
        code: "LIMITLESS_EXCHANGE_ADDRESS_MISSING"
      });
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
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") },
      undefined,
      process.env,
      undefined,
      positionRecorder
    );

    const submitted = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_status",
      dryRun: false,
      signedLegs: []
    });
    expect(submitted.status).toBe("SUBMITTED");
    expect(positionRecorder.applications.size).toBe(1);

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

  it("records full route share size when a venue reports a FILLED submit with cash-side fill amount", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FilledRouteSizeAdapter());
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      quoteId: "exec_quote_sell_full_size",
      side: "sell",
      venuePath: ["TEST"],
      requiredUserSignatureSteps: [],
      executableAmount: "80",
      legs: [{
        venue: "TEST",
        venueMarketId: "test-market",
        venueOutcomeId: "test-outcome",
        size: "80",
        price: 0.01,
        requiresUserSignature: false
      }]
    };
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") },
      undefined,
      process.env,
      undefined,
      positionRecorder
    );

    const submitted = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_sell_full_size",
      dryRun: false,
      signedLegs: []
    });

    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedLegs[0]?.fillState).toMatchObject({
      status: "FILLED",
      filledSize: "80",
      averagePrice: 0.01
    });
    const [application] = Array.from(positionRecorder.applications.values());
    expect(application?.fillState).toMatchObject({
      status: "FILLED",
      filledSize: "80",
      averagePrice: 0.01
    });
  });

  it("recovers submitted live order ids from persistent status storage after service restart", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new TestExecutionAdapter("TEST", { fillStatus: "FILLED", fillPrice: 0.51 }));
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      quoteId: "exec_quote_persisted_status",
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
    const statusRepository = new MemorySignedTradeStatusRepository();
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const firstService = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") },
      undefined,
      process.env,
      statusRepository
    );

    const submitted = await firstService.submit({
      userId: "user-1",
      quoteId: "exec_quote_persisted_status",
      dryRun: false,
      signedLegs: []
    });
    expect(submitted.submittedLegs[0]?.venueOrderId).toMatch(/^test-order-/);

    const restartedService = new SignedTradeBundleService(
      { getQuote: async () => null } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") },
      undefined,
      process.env,
      statusRepository,
      positionRecorder
    );

    const status = await restartedService.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_persisted_status"
    });

    expect(status).toMatchObject({
      executionId: "exec_quote_persisted_status",
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
    expect(status?.submittedLegs[0]?.venueOrderId).toBe(submitted.submittedLegs[0]?.venueOrderId);
    expect(positionRecorder.applications.size).toBe(1);
    const [application] = Array.from(positionRecorder.applications.values());
    expect(application).toMatchObject({
      executionId: "exec_quote_persisted_status",
      userId: "user-1",
      legIndex: 0,
      venueOrderId: submitted.submittedLegs[0]?.venueOrderId,
      route: {
        marketId: "canonical-market",
        outcomeId: "YES"
      },
      routeLeg: {
        venue: "TEST",
        venueMarketId: "test-market",
        venueOutcomeId: "test-outcome"
      },
      fillState: {
        status: "FILLED",
        filledSize: "1",
        averagePrice: 0.51
      }
    });

    await restartedService.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_persisted_status"
    });
    expect(positionRecorder.applications.size).toBe(1);
  });

  it("backfills legacy filled legs that were persisted without fill state", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new TestExecutionAdapter("TEST", { fillStatus: "OPEN", fillPrice: 0.51 }));
    const liveQuote: ExecutableTradeQuote = {
      ...quote(),
      quoteId: "exec_quote_legacy_filled",
      venuePath: ["TEST"],
      requiredUserSignatureSteps: [],
      legs: [{
        venue: "TEST",
        venueMarketId: "test-market",
        venueOutcomeId: "test-outcome",
        size: "3",
        price: 0.51,
        requiresUserSignature: false
      }]
    };
    const statusRepository = new MemorySignedTradeStatusRepository();
    await statusRepository.saveExecutionStatus({
      executionId: "exec_quote_legacy_filled",
      userId: "user-1",
      status: "FILLED",
      dryRun: false,
      submittedAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      route: liveQuote,
      submittedLegs: [{
        legIndex: 0,
        venue: "TEST",
        status: "FILLED",
        venueOrderId: "test-order-legacy"
      }]
    });
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => null } as never,
      registry,
      { getAccount: async () => account("PREDICT_FUN") },
      undefined,
      process.env,
      statusRepository,
      positionRecorder
    );

    const status = await sut.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_legacy_filled"
    });

    expect(status?.status).toBe("FILLED");
    expect(status?.submittedLegs[0]?.fillState).toMatchObject({
      status: "FILLED",
      filledSize: "3",
      averagePrice: 0.51
    });
    expect(positionRecorder.applications.size).toBe(1);
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

  it("reports Limitless live readiness blocked when allowance is below the bid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, input: RequestInit) => {
      const body = JSON.parse(String(input.body)) as { params: Array<{ data: string }> };
      const data = body.params[0]?.data ?? "";
      const isAllowance = data.startsWith("0xdd62ed3e");
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: isAllowance ? "0x0" : "0x0f4240"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => limitlessOnlyQuote() } as never,
      registryWithLimitless(),
      { getAccount: async () => account("LIMITLESS") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {
        LIMITLESS_BALANCE_PREFLIGHT_RPC_URL: "https://base-rpc.example",
        LIMITLESS_USDC_TOKEN_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      } as NodeJS.ProcessEnv
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_test" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("LIMITLESS: Limitless collateral allowance is below the total bid amount. Approve Limitless collateral before trading.");
    expect(readiness.venues.find((venue) => venue.venue === "LIMITLESS")?.collateral).toMatchObject({
      balance: "1",
      allowance: "0",
      requiredNotional: "0.43",
      spenderAddress: limitlessMarketExchange
    });
  });

  it("blocks live submit before Limitless venue calls when collateral allowance is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x0"
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => limitlessOnlyQuote() } as never,
      registryWithLimitless(true),
      { getAccount: async () => account("LIMITLESS") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {
        LIMITLESS_BALANCE_PREFLIGHT_RPC_URL: "https://base-rpc.example",
        LIMITLESS_USDC_TOKEN_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      } as NodeJS.ProcessEnv
    );

    await expect(sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_test",
      dryRun: false,
      signedLegs: []
    })).rejects.toMatchObject({
      code: "LIVE_SUBMIT_READINESS_BLOCKED",
      message: "LIMITLESS: Limitless collateral balance is below the total bid amount."
    });
  });

  it("reports Limitless live readiness fresh when balance and allowance cover the bid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "0x0f4240"
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const sut = new SignedTradeBundleService(
      { getQuote: async () => limitlessOnlyQuote() } as never,
      registryWithLimitless(),
      { getAccount: async () => account("LIMITLESS") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {
        LIMITLESS_BALANCE_PREFLIGHT_RPC_URL: "https://base-rpc.example",
        LIMITLESS_USDC_TOKEN_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
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
      predictTypes as never,
      predictTypedData.message
    );
    const wrongWallet = Wallet.createRandom();
    const typedData = limitlessRequest.typedData as {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      message: Record<string, unknown>;
    };
    const signature = await wrongWallet._signTypedData(typedData.domain, typedData.types as never, typedData.message);

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
