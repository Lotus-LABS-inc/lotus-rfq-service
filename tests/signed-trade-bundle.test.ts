import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "@ethersproject/wallet";
import {
  ExecutionVenueAdapterRegistry,
  LimitlessExecutionAdapter,
  OpinionExecutionAdapter,
  PredictFunExecutionAdapter,
  SignedTradeBundleService,
  TestExecutionAdapter,
  type ExecutableTradeQuote,
  type NormalizedVenueError,
  type PreparedVenueOrder,
  type VenueFillState,
  type VenueSubmitResult
} from "../src/execution-system/index.js";
import type { UserVenueAccount } from "../src/core/execution/user-venue-accounts.js";
import type {
  SignedTradeExecutionStatus,
  SignedTradeExecutionStatusRepository,
  SignedTradePositionRecorder,
  SignedTradeBundlePolymarketBalanceReader
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

class FailingPolymarketBalanceAdapter extends TestExecutionAdapter {
  public readonly venue = "POLYMARKET";
  public submitCalls = 0;

  public async submitOrder(): Promise<VenueSubmitResult> {
    this.submitCalls += 1;
    throw new Error("not enough balance / allowance: the balance is not enough -> balance: 0, order amount: 1274970");
  }

  public normalizeVenueError(): NormalizedVenueError {
    return {
      code: "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
      message: "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry.",
      retryable: false
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

const polymarketBuyQuote = (legOverrides: Partial<ExecutableTradeQuote["legs"][number]> = {}): ExecutableTradeQuote => ({
  ...quote(),
  quoteId: "exec_quote_polymarket_buy",
  venuePath: ["POLYMARKET"],
  executableAmount: "1.25",
  expectedPrice: 0.99,
  requiredUserSignatureSteps: [],
  legs: [{
    venue: "POLYMARKET",
    venueMarketId: "pm-market",
    venueOutcomeId: "123456789",
    size: "1.25",
    price: 0.99,
    requiresUserSignature: false,
    ...legOverrides
  }]
});

const polymarketSellQuote = (legOverrides: Partial<ExecutableTradeQuote["legs"][number]> = {}): ExecutableTradeQuote => ({
  ...polymarketBuyQuote(legOverrides),
  quoteId: "exec_quote_polymarket_sell",
  side: "sell",
  executableAmount: "10",
  expectedPrice: 0.25,
  legs: [{
    venue: "POLYMARKET",
    venueMarketId: "pm-market",
    venueOutcomeId: "123456789",
    size: "10",
    price: 0.25,
    requiresUserSignature: false,
    ...legOverrides
  }]
});

const polymarketBalanceReader = (
  buy: Partial<Awaited<ReturnType<SignedTradeBundlePolymarketBalanceReader["readUsableBalance"]>>> = {},
  sell: Partial<Awaited<ReturnType<SignedTradeBundlePolymarketBalanceReader["readConditionalTokenApproval"]>>> = {}
): SignedTradeBundlePolymarketBalanceReader => ({
  async readUsableBalance() {
    return {
      usableBalance: "10",
      collateralBalance: "10",
      collateralAllowance: "10",
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
      ...buy
    };
  },
  async readConditionalTokenApproval() {
    return {
      tokenId: "123456789",
      tokenBalance: "10",
      tokenAllowance: "10",
      ...sell
    };
  }
});

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
    const data = (limitlessRequest.signedPayloadHint as Record<string, unknown>).data as Record<string, unknown>;

    expect(Number(order.price)).toBe(0.43);
    expect(Number(order.takerAmount) / 1_000_000).toBeCloseTo(14.204, 6);
    expect(data.orderType).toBe("FOK");
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
    expect(hint.data?.isFillOrKill).toBe(true);
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

  it("stores safe failure reason codes instead of raw venue balance text", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    const adapter = new FailingPolymarketBalanceAdapter();
    registry.register(adapter);
    const liveQuote: ExecutableTradeQuote = {
      ...polymarketBuyQuote(),
      quoteId: "exec_quote_polymarket_failed"
    };
    const repository = new MemorySignedTradeStatusRepository();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      repository,
      undefined,
      polymarketBalanceReader()
    );

    const submitted = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_failed",
      dryRun: false,
      signedLegs: []
    });

    expect(adapter.submitCalls).toBe(1);
    expect(submitted.submittedLegs[0]).toMatchObject({
      status: "FAILED",
      reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
      reason: "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry."
    });
    expect(JSON.stringify(submitted)).not.toContain("balance is not enough");
    expect(JSON.stringify([...repository.rows.values()])).not.toContain("balance is not enough");
  });

  it("blocks Polymarket buy before venue submit when CLOB balance is zero", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    const adapter = new FailingPolymarketBalanceAdapter();
    registry.register(adapter);
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      { POLYMARKET_CHAIN_ID: "137" } as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "0",
        collateralBalance: "0",
        collateralAllowance: "9999999"
      })
    );

    await expect(sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_buy",
      dryRun: false,
      signedLegs: []
    })).rejects.toMatchObject({
      code: "LIVE_SUBMIT_READINESS_BLOCKED",
      message: "POLYMARKET: Polymarket CLOB collateral balance is below the order amount. Activate or fund Polymarket before trading."
    });
    expect(adapter.submitCalls).toBe(0);
  });

  it("blocks Polymarket buy when pUSD exists but CLOB allowance is zero", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "0",
        collateralBalance: "8.95741",
        collateralAllowance: "0",
        usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("POLYMARKET: Polymarket CLOB collateral allowance is below the order amount. Activate Polymarket funds to approve trading spenders.");
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "1.2375",
      balance: "8.95741",
      allowance: "0",
      usableBalance: "0",
      tokenSymbol: "pUSD",
      approvalMethod: "CLOB_PUSD_APPROVAL",
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
    });
  });

  it("keeps Polymarket buy readiness blocked when only on-chain CLOB spender allowance is confirmed", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "8.95741",
        collateralBalance: "0",
        collateralAllowance: "0",
        usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain(
      "POLYMARKET: Polymarket pUSD approval is confirmed on-chain, but Polymarket CLOB spendable collateral has not synced yet. Lotus refreshed CLOB readiness; retry after sync confirms."
    );
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "1.2375",
      balance: "0",
      allowance: "0",
      usableBalance: "8.95741",
      tokenSymbol: "pUSD",
      approvalMethod: "CLOB_PUSD_APPROVAL",
      usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
    });
  });

  it("passes Polymarket buy readiness when confirmed user CLOB sync covers required collateral", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "7.85565",
        collateralBalance: "7.85565",
        collateralAllowance: "115792089237316195420000000000000000000000000000000000000000000000000000",
        usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("fresh");
    expect(readiness.blockers).toEqual([]);
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "1.2375",
      balance: "7.85565",
      allowance: "115792089237316195420000000000000000000000000000000000000000000000000000",
      usableBalance: "7.85565",
      tokenSymbol: "pUSD",
      approvalMethod: "CLOB_PUSD_APPROVAL",
      usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
    });
  });

  it("includes Polymarket leg fee when checking required CLOB collateral", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote({ size: "1", price: 1, feeAmount: 0.1 }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "1.05",
        collateralBalance: "1.05",
        collateralAllowance: "9999999"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.venues[0]?.collateral.requiredNotional).toBe("1.1");
  });

  it("passes Polymarket buy readiness only when CLOB balance and allowance cover the order", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote({ size: "1", price: 1, feeAmount: 0.1 }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "1.1",
        collateralBalance: "1.1",
        collateralAllowance: "9999999"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("fresh");
  });

  it("handles scientific-notation balances in live readiness checks", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote({ size: "1", price: 1, feeAmount: 0.1 }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({
        usableBalance: "91564896837611e-9",
        collateralBalance: "91564896837611e-9",
        collateralAllowance: "9999999"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("fresh");
  });

  it("blocks Polymarket sell when conditional-token allowance is missing", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketSellQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      undefined,
      polymarketBalanceReader({}, {
        tokenBalance: "10",
        tokenAllowance: "0"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_sell" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("POLYMARKET: Polymarket conditional-token allowance is not ready. Activate Polymarket shares before selling.");
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "10",
      balance: "10",
      allowance: "0",
      tokenSymbol: "Polymarket shares",
      approvalMethod: "ERC1155_SET_APPROVAL_FOR_ALL"
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
      {
        getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]),
        getPredictFunJwt: () => "predict-user-jwt"
      },
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

  it("normalizes Predict.fun submit auth and allowance failures", () => {
    const adapter = new PredictFunExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.predict.fun",
      apiKey: "predict-api-key",
      liveExecutionEnabled: true,
      orderCreatePath: "/v1/orders",
      docsUrl: "https://dev.predict.fun",
      predictOrderMetadataClient
    });

    expect(adapter.normalizeVenueError(new Error("Predict.fun collateral USDT allowance is less than the total bid amount.")))
      .toMatchObject({
        code: "PREDICT_FUN_COLLATERAL_NOT_READY",
        message: "Predict.fun collateral is not ready for this order. Refresh balances, approve Predict.fun USDT, then retry."
      });

    expect(adapter.normalizeVenueError(new Error("Predict.fun requires a fresh user auth JWT for live order submit.")))
      .toMatchObject({
        code: "PREDICT_FUN_AUTH_REFRESH_REQUIRED",
        message: "Predict.fun requires a fresh user auth signature before live submit. Refresh the Predict.fun venue setup, then retry."
      });

    expect(adapter.normalizeVenueError(new Error("Insufficient shares: token balance is less than the total ask amount.")))
      .toMatchObject({
        code: "PREDICT_FUN_SHARES_NOT_READY",
        message: "Predict.fun shares are not spendable for this sell order. Refresh positions, approve Predict.fun shares, then retry."
      });
  });

  it("keeps Opinion live submit fail-closed", () => {
    const adapter = new OpinionExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.opinion.trade",
      apiKey: "opinion-api-key",
      liveExecutionEnabled: true,
      orderCreatePath: "/orders",
      docsUrl: "https://docs.opinion.trade"
    });

    expect(adapter.normalizeVenueError(new Error("provider returned an unexpected live submit error")))
      .toMatchObject({
        code: "OPINION_LIVE_SUBMIT_NOT_ENABLED",
        message: "Opinion live order submission is not enabled. Lotus can quote Opinion markets, but live submit remains disabled."
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
      {
        getAccount: async (_userId, venue) => account(venue.toUpperCase() as UserVenueAccount["venue"]),
        getPredictFunJwt: () => "predict-user-jwt"
      },
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
