import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Wallet } from "@ethersproject/wallet";
import { AbiCoder, hexlify, keccak256, toUtf8Bytes } from "ethers";
import {
  ExecutionVenueAdapterRegistry,
  LimitlessExecutionAdapter,
  OpinionExecutionAdapter,
  PolymarketExecutionAdapterV2,
  PredictFunExecutionAdapter,
  SignedTradeBundleService,
  TestExecutionAdapter,
  type ExecutableTradeQuote,
  type NormalizedVenueError,
  type PreparedVenueOrder,
  type VenueFillState,
  type VenueSettlementState,
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
const polymarketOrderTypeString = "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
const polymarketOrderTypeHash = keccak256(toUtf8Bytes(polymarketOrderTypeString));
const polymarketDomainTypeHash = keccak256(toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const abiCoder = AbiCoder.defaultAbiCoder();

const polymarket1271SuffixForTypedData = (typedData: {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  message: { contents: Record<string, unknown> };
}): string => {
  const contents = typedData.message.contents;
  const domainSeparator = keccak256(abiCoder.encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [
      polymarketDomainTypeHash,
      keccak256(toUtf8Bytes(typedData.domain.name)),
      keccak256(toUtf8Bytes(typedData.domain.version)),
      BigInt(typedData.domain.chainId),
      typedData.domain.verifyingContract
    ]
  ));
  const contentsHash = keccak256(abiCoder.encode(
    ["bytes32", "uint256", "address", "address", "uint256", "uint256", "uint256", "uint8", "uint8", "uint256", "bytes32", "bytes32"],
    [
      polymarketOrderTypeHash,
      BigInt(String(contents.salt)),
      String(contents.maker),
      String(contents.signer),
      BigInt(String(contents.tokenId)),
      BigInt(String(contents.makerAmount)),
      BigInt(String(contents.takerAmount)),
      Number(contents.side),
      Number(contents.signatureType),
      BigInt(String(contents.timestamp)),
      String(contents.metadata),
      String(contents.builder)
    ]
  ));
  return `0x${domainSeparator.slice(2)}${contentsHash.slice(2)}${hexlify(toUtf8Bytes(polymarketOrderTypeString)).slice(2)}${polymarketOrderTypeString.length.toString(16).padStart(4, "0")}`;
};

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
  public readonly corrections: Array<Parameters<NonNullable<SignedTradePositionRecorder["reconcileFailedSell"]>>[0]> = [];

  public async recordFilledLeg(input: Parameters<SignedTradePositionRecorder["recordFilledLeg"]>[0]): Promise<void> {
    this.applications.set(
      `${input.executionId}:${input.userId}:${input.legIndex}:${input.venueOrderId}`,
      structuredClone(input)
    );
  }

  public async reconcileFailedSell(input: Parameters<NonNullable<SignedTradePositionRecorder["reconcileFailedSell"]>>[0]): Promise<void> {
    this.corrections.push(structuredClone(input));
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

class SequentialPolymarketRejectionAdapter extends TestExecutionAdapter {
  public readonly venue = "POLYMARKET";
  public submitCalls = 0;

  public async submitOrder(): Promise<VenueSubmitResult> {
    this.submitCalls += 1;
    throw new Error(this.submitCalls === 1
      ? "invalid order: maker amount violates tick size for FOK"
      : "provider returned an unexpected live submit error");
  }

  public normalizeVenueError(error: unknown): NormalizedVenueError {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("tick size")) {
      return {
        code: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
        message: "Price moved before execution. Refresh route and retry.",
        retryable: false
      };
    }
    return {
      code: "POLYMARKET_CLOB_UNKNOWN_REJECTED_BY_VENUE",
      message: "Polymarket rejected this order for an unknown venue reason. Raw redacted evidence was captured for debugging.",
      retryable: false
    };
  }
}

class PolymarketSubmittedFillAdapter extends TestExecutionAdapter {
  public readonly venue = "POLYMARKET";
  public readonly fillStateLookups: string[] = [];
  public readonly settlementLookups: string[] = [];
  public readonly fillStateLookupContexts: unknown[] = [];
  public readonly settlementLookupContexts: unknown[] = [];

  public constructor(private readonly settlementStatus: "SETTLEMENT_PENDING" | "SETTLEMENT_VERIFIED") {
    super("POLYMARKET");
  }

  public async submitOrder(): Promise<VenueSubmitResult> {
    return {
      venueOrderId: "pm-order-1",
      fillId: "pm-fill-1",
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: 0.993
    };
  }

  public async fetchFillState(venueOrderId = "", context?: unknown): Promise<VenueFillState> {
    this.fillStateLookups.push(venueOrderId);
    this.fillStateLookupContexts.push(structuredClone(context));
    return {
      status: "OPEN",
      filledSize: "0",
      averagePrice: 0.993
    };
  }

  public async fetchSettlementState(fillOrOrderId = "", context?: unknown): Promise<VenueSettlementState> {
    this.settlementLookups.push(fillOrOrderId);
    this.settlementLookupContexts.push(structuredClone(context));
    return {
      status: this.settlementStatus,
      evidence: this.settlementStatus === "SETTLEMENT_VERIFIED"
        ? { source: "polymarket_v2_clob_sdk", fillOrOrderId, tradeId: "pm-trade-1" }
        : { source: "polymarket_v2_clob_sdk", fillOrOrderId, reason: "no_trade_found" }
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

const polymarketSigningEnv = {
  POLYMARKET_CLOB_HOST: "https://clob.polymarket.test",
  POLYMARKET_CHAIN_ID: "137",
  POLYMARKET_BUILDER_CODE: "0x6c4b67c64d2acb6381b5c8a5016495aece3d922799553ef2989254777f21c15c",
  POLYMARKET_SIGNATURE_TYPE: "POLY_1271",
  POLYMARKET_TICK_SIZE: "0.001"
} as NodeJS.ProcessEnv;

const polymarketDepositWalletAccount = (): UserVenueAccount => ({
  ...account("POLYMARKET"),
  walletAddress: wallet.address,
  venueAccountAddress: "0x1111111111111111111111111111111111111111",
  venueAccountType: "DEPOSIT_WALLET"
});

const startPolymarketClobFixtureServer = async (): Promise<{ host: string; close: () => Promise<void> }> => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/tick-size") {
      response.end(JSON.stringify({ minimum_tick_size: "0.001" }));
      return;
    }
    if (url.pathname === "/neg-risk") {
      response.end(JSON.stringify({ neg_risk: false }));
      return;
    }
    if (url.pathname === "/version") {
      response.end(JSON.stringify({ version: 2 }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    host: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
};

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

  it("quantizes Polymarket market-buy signature amounts before Turnkey signs", async () => {
    const fixtureServer = await startPolymarketClobFixtureServer();
    const env = {
      ...polymarketSigningEnv,
      POLYMARKET_CLOB_HOST: fixtureServer.host,
      POLYMARKET_TICK_SIZE: undefined
    } as NodeJS.ProcessEnv;
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new PolymarketExecutionAdapterV2({
      executionMode: "v2",
      liveExecutionEnabled: false,
      clobHost: env.POLYMARKET_CLOB_HOST,
      chainId: env.POLYMARKET_CHAIN_ID,
      builderCode: env.POLYMARKET_BUILDER_CODE,
      signatureType: env.POLYMARKET_SIGNATURE_TYPE
    }));
    const liveQuote: ExecutableTradeQuote = {
      ...polymarketBuyQuote({
        venueOutcomeId: "9204103845295998574174644655568224547826780478747010463640756803659982305491",
        size: "2.04081633",
        price: 0.989,
        requiresUserSignature: true,
        metadata: {
          tickSize: "0.001",
          negRisk: false
        }
      }),
      requiredUserSignatureSteps: ["POLYMARKET user signature required"]
    };
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => polymarketDepositWalletAccount() },
      () => new Date("2026-05-20T19:18:20.000Z"),
      env
    );
    try {
      const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });
      const orderRequest = prepared.signatureRequests.find((request) => request.requestType === "ORDER")!;
      const data = (orderRequest.signedPayloadHint.data as Record<string, unknown>);
      const order = data.order as Record<string, unknown>;
      const typedData = orderRequest.typedData as {
        domain: { name: string; version: string; chainId: number; verifyingContract: string };
        message: { contents: Record<string, unknown> };
      };

      expect(order.makerAmount).toBe("2037960");
      expect(order.takerAmount).toBe("2040000");
      expect(typedData.message.contents.makerAmount).toBe("2037960");
      expect(typedData.message.contents.takerAmount).toBe("2040000");
      expect(BigInt(String(order.makerAmount)) * 1_000n / BigInt(String(order.takerAmount))).toBe(999n);
      expect(BigInt(String(order.takerAmount)) % 10n).toBe(0n);
      expect(data.polymarketSignatureSuffix).toBe(polymarket1271SuffixForTypedData(typedData));
      expect(data.orderType).toBe("FOK");
    } finally {
      await fixtureServer.close();
    }
  });

  it("adds enough Polymarket market-buy cushion for high-price FOK orders", async () => {
    const fixtureServer = await startPolymarketClobFixtureServer();
    const env = {
      ...polymarketSigningEnv,
      POLYMARKET_CLOB_HOST: fixtureServer.host,
      POLYMARKET_TICK_SIZE: undefined
    } as NodeJS.ProcessEnv;
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new PolymarketExecutionAdapterV2({
      executionMode: "v2",
      liveExecutionEnabled: false,
      clobHost: env.POLYMARKET_CLOB_HOST,
      chainId: env.POLYMARKET_CHAIN_ID,
      builderCode: env.POLYMARKET_BUILDER_CODE,
      signatureType: env.POLYMARKET_SIGNATURE_TYPE
    }));
    const liveQuote: ExecutableTradeQuote = {
      ...polymarketBuyQuote({
        venueOutcomeId: "15636396498081492607537245191035256780946494107835473972503944043229908184003",
        size: "2.02020202",
        price: 0.992,
        requiresUserSignature: true,
        metadata: {
          tickSize: "0.001",
          negRisk: false
        }
      }),
      requiredUserSignatureSteps: ["POLYMARKET user signature required"]
    };
    const sut = new SignedTradeBundleService(
      { getQuote: async () => liveQuote } as never,
      registry,
      { getAccount: async () => polymarketDepositWalletAccount() },
      () => new Date("2026-05-20T19:18:20.000Z"),
      env
    );
    try {
      const prepared = await sut.prepare({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });
      const orderRequest = prepared.signatureRequests.find((request) => request.requestType === "ORDER")!;
      const data = orderRequest.signedPayloadHint.data as Record<string, unknown>;
      const order = data.order as Record<string, unknown>;

      expect(order.makerAmount).toBe("2017980");
      expect(order.takerAmount).toBe("2020000");
      expect(BigInt(String(order.makerAmount)) * 1_000n / BigInt(String(order.takerAmount))).toBe(999n);
      expect(data.orderType).toBe("FOK");
    } finally {
      await fixtureServer.close();
    }
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

  it("preserves the specific Polymarket failure reason when a duplicate submit returns unknown", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    const adapter = new SequentialPolymarketRejectionAdapter();
    registry.register(adapter);
    const liveQuote: ExecutableTradeQuote = {
      ...polymarketBuyQuote(),
      quoteId: "exec_quote_polymarket_duplicate_failure"
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

    const first = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_duplicate_failure",
      dryRun: false,
      signedLegs: []
    });
    const second = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_duplicate_failure",
      dryRun: false,
      signedLegs: []
    });
    const stored = await repository.findExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_polymarket_duplicate_failure"
    });

    expect(adapter.submitCalls).toBe(2);
    expect(first.submittedLegs[0]).toMatchObject({
      status: "FAILED",
      reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"
    });
    expect(second.submittedLegs[0]).toMatchObject({
      status: "FAILED",
      reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
      reason: "Price moved before execution. Refresh route and retry."
    });
    expect(stored?.submittedLegs[0]).toMatchObject({
      status: "FAILED",
      reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
      reason: "Price moved before execution. Refresh route and retry."
    });
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
    expect(readiness.venues[0]).toMatchObject({
      requiresUserSync: false,
      liveSubmitSpendableBalance: "0"
    });
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "1.24875",
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
      requiredNotional: "1.24875",
      balance: "0",
      allowance: "0",
      usableBalance: "8.95741",
      tokenSymbol: "pUSD",
      approvalMethod: "CLOB_PUSD_APPROVAL",
      usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE"
    });
  });

  it("marks Polymarket buy readiness fresh when confirmed user CLOB sync covers required collateral", async () => {
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
    expect(readiness.venues[0]).toMatchObject({
      readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
      nextAction: "SUBMIT",
      requiresUserSync: false,
      liveSubmitSpendableBalance: "7.85565"
    });
    expect(readiness.venues[0]?.collateral).toMatchObject({
      requiredNotional: "1.24875",
      balance: "7.85565",
      allowance: "115792089237316195420000000000000000000000000000000000000000000000000000",
      usableBalance: "7.85565",
      tokenSymbol: "pUSD",
      approvalMethod: "CLOB_PUSD_APPROVAL",
      usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED"
    });
  });

  it("marks Polymarket buy readiness fresh only when CLOB live submit spendable collateral is confirmed", async () => {
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
        usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_buy" });

    expect(readiness.status).toBe("fresh");
    expect(readiness.venues[0]).toMatchObject({
      status: "fresh",
      readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
      nextAction: "SUBMIT",
      requiresUserSync: false,
      liveSubmitSpendableBalance: "7.85565"
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

  it("reconciles stale Polymarket sellable positions when live share balance is below the sell amount", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketSellQuote() } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      positionRecorder,
      polymarketBalanceReader({}, {
        tokenBalance: "0",
        tokenAllowance: "0"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_sell" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("POLYMARKET: Polymarket share balance is below the sell amount. Sellable balance: 0 shares.");
    expect(positionRecorder.corrections).toHaveLength(1);
    expect(positionRecorder.corrections[0]).toMatchObject({
      executionId: "exec_quote_polymarket_sell",
      userId: "user-1",
      legIndex: 0,
      venue: "POLYMARKET",
      reason: "Polymarket live share balance is below the quoted sell amount. Sellable balance: 0 shares.",
      route: {
        side: "sell",
        marketId: "canonical-market",
        outcomeId: "YES"
      },
      routeLeg: {
        venue: "POLYMARKET",
        venueOutcomeId: "123456789"
      }
    });
  });

  it("reconciles Polymarket sellable size to the nonzero live share balance instead of clearing the position", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    registry.register(new FailingPolymarketBalanceAdapter());
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketSellQuote({ size: "6.072426" }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      positionRecorder,
      polymarketBalanceReader({}, {
        tokenBalance: "6.0724",
        tokenAllowance: "10"
      })
    );

    const readiness = await sut.getLiveReadiness({ userId: "user-1", quoteId: "exec_quote_polymarket_sell" });

    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers).toContain("POLYMARKET: Polymarket share balance is below the sell amount. Sellable balance: 6.0724 shares.");
    expect(positionRecorder.corrections).toHaveLength(1);
    expect(positionRecorder.corrections[0]).toMatchObject({
      executionId: "exec_quote_polymarket_sell",
      liveSellableSize: "6.0724",
      reason: "Polymarket live share balance is below the quoted sell amount. Sellable balance: 6.0724 shares."
    });
  });

  it("does not record Polymarket positions from accepted orders until settlement evidence verifies the trade", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    const adapter = new PolymarketSubmittedFillAdapter("SETTLEMENT_PENDING");
    registry.register(adapter);
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote({ size: "2.02020202", price: 0.993 }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      positionRecorder,
      polymarketBalanceReader({
        usableBalance: "10",
        collateralBalance: "10",
        collateralAllowance: "10",
        usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
      })
    );

    const submitted = await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_buy",
      dryRun: false,
      signedLegs: []
    });

    expect(submitted.submittedLegs[0]).toMatchObject({
      venue: "POLYMARKET",
      status: "SUBMITTED",
      venueOrderId: "pm-order-1",
      fillId: "pm-fill-1"
    });
    expect(submitted.submittedLegs[0]?.fillState).toBeUndefined();
    expect(positionRecorder.applications.size).toBe(0);

    const status = await sut.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_polymarket_buy"
    });

    expect(adapter.fillStateLookups).toEqual(["pm-order-1"]);
    expect(adapter.settlementLookups).toEqual(["pm-fill-1"]);
    expect(status).toMatchObject({
      executionId: "exec_quote_polymarket_buy",
      status: "SUBMITTED",
      submittedLegs: [{
        venue: "POLYMARKET",
        status: "OPEN",
        fillId: "pm-fill-1",
        fillState: {
          status: "OPEN",
          filledSize: "0"
        },
        settlementState: {
          status: "SETTLEMENT_PENDING",
          evidence: {
            reason: "no_trade_found"
          }
        }
      }]
    });
    expect(positionRecorder.applications.size).toBe(0);
  });

  it("records Polymarket positions after settlement verifies using the fill id", async () => {
    const registry = new ExecutionVenueAdapterRegistry();
    const adapter = new PolymarketSubmittedFillAdapter("SETTLEMENT_VERIFIED");
    registry.register(adapter);
    const positionRecorder = new MemorySignedTradePositionRecorder();
    const sut = new SignedTradeBundleService(
      { getQuote: async () => polymarketBuyQuote({ size: "2.02020202", price: 0.993 }) } as never,
      registry,
      { getAccount: async () => account("POLYMARKET") },
      () => new Date("2026-05-07T00:00:00.000Z"),
      {} as NodeJS.ProcessEnv,
      undefined,
      positionRecorder,
      polymarketBalanceReader({
        usableBalance: "10",
        collateralBalance: "10",
        collateralAllowance: "10",
        usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE"
      })
    );

    await sut.submit({
      userId: "user-1",
      quoteId: "exec_quote_polymarket_buy",
      dryRun: false,
      signedLegs: []
    });
    const status = await sut.getExecutionStatus({
      userId: "user-1",
      executionId: "exec_quote_polymarket_buy"
    });

    expect(adapter.settlementLookups).toEqual(["pm-fill-1"]);
    expect(adapter.fillStateLookupContexts[0]).toMatchObject({
      userId: "user-1",
      venueOrderId: "pm-order-1",
      fillId: "pm-fill-1",
      venueAccountAddress: wallet.address,
      route: {
        marketId: "canonical-market",
        outcomeId: "YES",
        side: "buy"
      },
      routeLeg: {
        venueMarketId: "pm-market",
        venueOutcomeId: "123456789",
        side: "buy",
        size: "2.02020202",
        price: 0.993
      }
    });
    expect(adapter.settlementLookupContexts[0]).toMatchObject({
      venueOrderId: "pm-order-1",
      fillId: "pm-fill-1",
      venueAccountAddress: wallet.address
    });
    expect(status?.status).toBe("FILLED");
    expect(positionRecorder.applications.size).toBe(1);
    const [application] = Array.from(positionRecorder.applications.values());
    expect(application).toMatchObject({
      executionId: "exec_quote_polymarket_buy",
      userId: "user-1",
      legIndex: 0,
      venueOrderId: "pm-order-1",
      fillState: {
        status: "FILLED",
        filledSize: "2.02020202",
        averagePrice: 0.993
      }
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
