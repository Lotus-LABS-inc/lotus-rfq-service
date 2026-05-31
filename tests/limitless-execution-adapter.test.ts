import { describe, expect, it } from "vitest";
import {
  getContractAddress,
  OrderBuilder,
  OrderType,
  Side,
  type OrderResponse,
  type UnsignedOrder
} from "@limitless-exchange/sdk";
import { Wallet } from "@ethersproject/wallet";
import {
  getLimitlessExecutionAdapterEnvStatus,
  LimitlessExecutionAdapter,
  LimitlessExecutionNotConfiguredError,
  mapLimitlessOrderStatusToFillState,
  mapLimitlessOrderStatusToSettlementState,
  type LimitlessOrderClient,
  type LimitlessUserSignedRelayClient
} from "../src/execution-system/limitless-execution-adapter.js";
import {
  evaluateLimitlessLiveSubmitHarness,
  limitlessLiveSubmitOperatorConfirmation
} from "../src/execution-system/limitless-live-submit-harness.js";
import type { ExecutionLegV0 } from "../src/execution-system/types.js";

const limitlessTokenId = "123456789";

const leg = (): ExecutionLegV0 => ({
  executionLegId: "execution-1-leg-1",
  parentExecutionId: "execution-1",
  venue: "LIMITLESS",
  venueMarketId: "limitless-market-slug",
  venueOutcomeId: limitlessTokenId,
  side: "buy",
  size: "1",
  price: 0.42,
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

const liveConfig = {
  executionMode: "backend_signer" as const,
  baseUrl: "https://api.limitless.exchange",
  apiKey: "server-side-api-key",
  privateKey: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f",
  liveExecutionEnabled: true
};

const delegatedLiveConfig = {
  executionMode: "delegated_partner_server_wallet" as const,
  baseUrl: "https://api.limitless.exchange",
  hmacTokenId: "partner-token-id",
  hmacSecret: "partner-hmac-secret",
  partnerAccountEnabled: true,
  delegatedProfileId: "12345",
  liveExecutionEnabled: true
};

const userSignedRelayLiveConfig = {
  executionMode: "user_signed_backend_relay" as const,
  baseUrl: "https://api.limitless.exchange",
  hmacTokenId: "partner-token-id",
  hmacSecret: "partner-hmac-secret",
  partnerAccountEnabled: true,
  liveExecutionEnabled: true
};

const signerWallet = new Wallet("0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f");
const evmAddress = signerWallet.address;
const typedDataForLimitlessOrder = (order: UnsignedOrder) => ({
  domain: {
    name: "Limitless CTF Exchange",
    version: "1",
    chainId: 8453,
    verifyingContract: getContractAddress("CTF")
  },
  types: {
    Order: [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "signer", type: "address" },
      { name: "taker", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "makerAmount", type: "uint256" },
      { name: "takerAmount", type: "uint256" },
      { name: "expiration", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "feeRateBps", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "signatureType", type: "uint8" }
    ]
  },
  message: {
    salt: order.salt,
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: order.tokenId,
    makerAmount: order.makerAmount,
    takerAmount: order.takerAmount,
    expiration: order.expiration,
    nonce: order.nonce,
    feeRateBps: order.feeRateBps,
    side: order.side,
    signatureType: order.signatureType
  }
});

const limitlessRelayPayload = async (overrides: Record<string, unknown> = {}) => {
  const builder = new OrderBuilder(evmAddress, 300);
  const order = {
    ...builder.buildOrder({
      tokenId: String(overrides.tokenId ?? limitlessTokenId),
      side: overrides.side === Side.SELL ? Side.SELL : Side.BUY,
      makerAmount: Number(overrides.makerAmount ?? 0.42)
    }),
    ...((overrides.orderOverrides as Record<string, unknown> | undefined) ?? {})
  } as UnsignedOrder;
  const typedData = typedDataForLimitlessOrder(order);
  const signature = await signerWallet._signTypedData(typedData.domain, typedData.types, typedData.message);
  return {
  expectedBinding: {
    profileId: "12345",
    venueAccountId: "12345",
    signerAddress: evmAddress,
    venueAccountAddress: evmAddress
  },
  signedPayload: {
    signer: String(overrides.signer ?? evmAddress),
    account: String(overrides.account ?? evmAddress),
    signature,
    typedData,
    data: {
      order,
      orderType: OrderType.FOK,
      marketSlug: String(overrides.marketSlug ?? "limitless-market-slug"),
      ownerId: "12345"
    }
  }
  };
};

const mockOrderResponse = (): OrderResponse => ({
  order: {
    id: "limitless-order-1",
    createdAt: "2026-05-02T00:00:00.000Z",
    makerAmount: 1,
    takerAmount: 0.42,
    expiration: null,
    signatureType: 0,
    salt: "123",
    maker: "0x0000000000000000000000000000000000000001",
    signer: "0x0000000000000000000000000000000000000001",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: limitlessTokenId,
    side: Side.BUY,
    feeRateBps: 0,
    nonce: 0,
    signature: "0xsig",
    orderType: "FOK",
    price: 0.42,
    marketId: 100
  }
});

const minedOrderStatus = () => ({
  status: "found",
  data: {
    order: {
      order: {
        id: "limitless-order-1",
        price: 0.42
      }
    },
    makerMatches: [{ id: "match-1", matchedSize: "1000000", orderId: "limitless-order-1" }],
    execution: {
      matched: true,
      settlementStatus: "MINED",
      tradeEventId: "trade-event-1",
      txHash: "0xabc",
      totalsRaw: {
        contractsNet: "1000000"
      }
    }
  }
});

const unmatchedOrderStatus = () => ({
  status: "found",
  data: {
    order: {
      order: {
        id: "limitless-order-1",
        price: 0.42
      }
    },
    makerMatches: [],
    execution: {
      matched: false,
      settlementStatus: "UNMATCHED",
      totalsRaw: {
        contractsNet: "0"
      }
    }
  }
});

const failedOrderStatus = () => ({
  status: "found",
  data: {
    order: {
      order: {
        id: "limitless-order-1",
        price: 0.42
      },
      execution: {
        matched: true,
        settlementStatus: "REVERTED",
        txHash: "0xfailed"
      }
    },
    makerMatches: [{ id: "match-1", matchedSize: "1000000", orderId: "limitless-order-1" }]
  }
});

describe("LimitlessExecutionAdapter", () => {
  it("defaults to not configured unless backend signer mode is explicitly selected", () => {
    const status = getLimitlessExecutionAdapterEnvStatus({
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "false"
    });

    expect(status).toMatchObject({
      executionSigningModel: "BACKEND_SIGNER",
      featureFlagSelected: false,
      liveExecutionEnabled: false,
      readinessState: "NOT_CONFIGURED"
    });
  });

  it("supports delegated partner server-wallet mode without requiring an execution private key", () => {
    const status = getLimitlessExecutionAdapterEnvStatus({
      LIMITLESS_EXECUTION_MODE: "delegated_partner_server_wallet",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_PARTNER_ACCOUNT_ENABLED: "true",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID: "partner-token-id",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET: "partner-secret",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true"
    });

    expect(status).toMatchObject({
      executionMode: "delegated_partner_server_wallet",
      executionSigningModel: "DELEGATED_BACKEND_SIGNER",
      featureFlagSelected: true,
      liveExecutionEnabled: true,
      readinessState: "LIVE_READY",
      requiredEnvPresent: true,
      missingEnv: []
    });
  });

  it("supports user-signed backend relay mode without requiring an execution private key", () => {
    const status = getLimitlessExecutionAdapterEnvStatus({
      LIMITLESS_EXECUTION_MODE: "user_signed_backend_relay",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_PARTNER_ACCOUNT_ENABLED: "true",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID: "partner-token-id",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET: "partner-secret",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true"
    });

    expect(status).toMatchObject({
      executionMode: "user_signed_backend_relay",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      featureFlagSelected: true,
      liveExecutionEnabled: true,
      readinessState: "LIVE_READY",
      requiredEnvPresent: true,
      missingEnv: []
    });
    expect(status.missingEnv).not.toContain("LIMITLESS_EXECUTION_PRIVATE_KEY");
  });

  it("still requires the execution private key in legacy backend signer mode", () => {
    const status = getLimitlessExecutionAdapterEnvStatus({
      LIMITLESS_EXECUTION_MODE: "backend_signer",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_API_KEY: "server-side-api-key",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true"
    });

    expect(status).toMatchObject({
      executionMode: "backend_signer",
      executionSigningModel: "BACKEND_SIGNER",
      readinessState: "NOT_CONFIGURED",
      missingEnv: ["LIMITLESS_EXECUTION_PRIVATE_KEY"]
    });
  });

  it("prepares dry-run orders without requiring live secrets", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "backend_signer",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });

    const prepared = await adapter.prepareOrder(leg());

    expect(prepared).toMatchObject({
      venue: "LIMITLESS",
      clientOrderId: "execution-1-leg-1",
      payload: {
        marketSlug: "limitless-market-slug",
        tokenId: limitlessTokenId,
        side: Side.BUY,
        size: 1,
        price: 0.42,
        orderType: OrderType.FOK
      }
    });
    expect(JSON.stringify(prepared)).not.toContain("private");
    expect(JSON.stringify(prepared)).not.toContain("api-key");
  });

  it("rounds Limitless sizes down to venue contract precision before signing", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });

    const prepared = await adapter.prepareOrder({
      ...leg(),
      size: "14.20454545"
    });

    expect(prepared.payload).toMatchObject({
      size: 14.204
    });
  });

  it("uses market venue exchange metadata for Limitless signing", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });
    const marketExchange = "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47";

    const prepared = await adapter.prepareOrder({
      ...leg(),
      metadata: {
        limitlessExchangeAddress: marketExchange
      }
    });

    expect(prepared.payload).toMatchObject({
      exchange: marketExchange.toLowerCase()
    });
  });

  it("prepares user-signed relay instructions without letting the backend sign", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "user_signed_backend_relay",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });

    const prepared = await adapter.prepareOrder(leg());

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      signingRequired: true,
      backendMayRelaySignedPayload: true,
      backendMaySign: false,
      marketSlug: "limitless-market-slug",
      tokenId: limitlessTokenId,
      metadata: {
        executionSigningModel: "USER_SIGNED_BACKEND_RELAY"
      }
    });
    expect(JSON.stringify(prepared)).not.toContain("partner-hmac-secret");
  });

  it("blocks submission while live execution is disabled", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "backend_signer",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });
    const prepared = await adapter.prepareOrder(leg());

    await expect(adapter.submitOrder(prepared)).rejects.toMatchObject({
      reasonCode: "LIMITLESS_LIVE_EXECUTION_DISABLED"
    });
  });

  it("blocks live submission when required live env is incomplete", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "backend_signer",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: true
    });
    const prepared = await adapter.prepareOrder(leg());

    await expect(adapter.submitOrder(prepared)).rejects.toBeInstanceOf(LimitlessExecutionNotConfiguredError);
  });

  it("normalizes Limitless collateral and share readiness failures", () => {
    const adapter = new LimitlessExecutionAdapter(liveConfig);

    expect(adapter.normalizeVenueError(
      new Error("Insufficient collateral allowance for this order.")
    )).toMatchObject({
      code: "LIMITLESS_COLLATERAL_NOT_READY",
      message: "Limitless collateral is not ready for this order. Refresh balances, approve Limitless collateral, then retry."
    });

    expect(adapter.normalizeVenueError(
      new Error("Conditional token allowance not set.")
    )).toMatchObject({
      code: "LIMITLESS_SHARES_NOT_READY",
      message: "Limitless shares are not spendable for this sell order. Refresh positions, approve Limitless shares, then retry."
    });
  });

  it("maps mocked live order creation to a submitted venue result", async () => {
    const client: LimitlessOrderClient = {
      async createOrder(input) {
        expect(input).toMatchObject({
          marketSlug: "limitless-market-slug",
          tokenId: limitlessTokenId,
          side: Side.BUY,
          price: 0.42,
          size: 1,
          orderType: OrderType.FOK
        });
        return mockOrderResponse();
      },
      async cancel() {
        return { message: "cancelled" };
      }
    };
    const adapter = new LimitlessExecutionAdapter(liveConfig, client);
    const submitted = await adapter.submitOrder(await adapter.prepareOrder(leg()));

    expect(submitted).toEqual({
      venueOrderId: "limitless-order-1",
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: 0.42
    });
  });

  it("submits delegated orders on behalf of the linked profile id", async () => {
    const client: LimitlessOrderClient = {
      async createOrder(input) {
        expect(input).toMatchObject({
          marketSlug: "limitless-market-slug",
          tokenId: limitlessTokenId,
          side: Side.BUY,
          price: 0.42,
          size: 1,
          orderType: OrderType.FOK,
          onBehalfOf: 12345
        });
        return mockOrderResponse();
      },
      async cancel(orderId, onBehalfOf) {
        expect(orderId).toBe("limitless-order-1");
        expect(onBehalfOf).toBe(12345);
        return { message: "cancelled" };
      },
      async getFillState(orderId, onBehalfOf) {
        expect(orderId).toBe("limitless-order-1");
        expect(onBehalfOf).toBe(12345);
        return { status: "OPEN", filledSize: "0", averagePrice: 0, offchainFilled: false };
      },
      async getSettlementState(orderId, onBehalfOf) {
        expect(orderId).toBe("limitless-order-1");
        expect(onBehalfOf).toBe(12345);
        return { status: "SETTLEMENT_PENDING", evidence: { delegatedProfileScoped: true } };
      }
    };
    const adapter = new LimitlessExecutionAdapter(delegatedLiveConfig, client);
    const prepared = await adapter.prepareOrder(leg());
    const submitted = await adapter.submitOrder(prepared);

    expect(prepared.payload).toMatchObject({
      delegatedProfileId: "12345",
      metadata: {
        executionSigningModel: "DELEGATED_BACKEND_SIGNER"
      }
    });
    expect(submitted.status).toBe("SUBMITTED");
    await expect(adapter.cancelOrder("limitless-order-1")).resolves.toEqual({ cancelled: true });
    await expect(adapter.fetchFillState("limitless-order-1")).resolves.toMatchObject({ status: "OPEN" });
    await expect(adapter.fetchSettlementState("limitless-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: { delegatedProfileScoped: true }
    });
  });

  it("relays only a user-signed Limitless payload on behalf of the linked profile", async () => {
    const relayClient: LimitlessUserSignedRelayClient = {
      async submitSignedOrder(input) {
        expect(input).toMatchObject({
          onBehalfOf: 12345,
          ownerId: 12345,
          signedPayload: {
            marketSlug: "limitless-market-slug",
            orderType: OrderType.FOK,
            order: {
              maker: evmAddress,
              signer: evmAddress,
              tokenId: limitlessTokenId,
              side: Side.BUY,
              makerAmount: 420000,
              takerAmount: 1,
              signature: expect.stringMatching(/^0x/)
            }
          }
        });
        expect(input.signedPayload).not.toHaveProperty("signer");
        expect(input.signedPayload).not.toHaveProperty("account");
        expect(input.signedPayload).not.toHaveProperty("tokenId");
        return { order: { id: "limitless-relay-order-1", price: 0.42 } };
      },
      async getOrderStatus(orderId, onBehalfOf) {
        expect(orderId).toBe("limitless-relay-order-1");
        expect(onBehalfOf).toBe(12345);
        return minedOrderStatus();
      }
    };
    const adapter = new LimitlessExecutionAdapter(userSignedRelayLiveConfig, undefined, relayClient);
    const prepared = await adapter.prepareOrder(leg());
    prepared.payload = {
      ...(prepared.payload as Record<string, unknown>),
      relayPayload: await limitlessRelayPayload()
    };

    await expect(adapter.submitOrder(prepared)).resolves.toEqual({
      venueOrderId: "limitless-relay-order-1",
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: 0.42
    });
    await expect(adapter.fetchFillState("limitless-relay-order-1")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "1"
    });
    await expect(adapter.fetchSettlementState("limitless-relay-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_VERIFIED",
      evidence: {
        settlementEvidenceVerified: true
      }
    });
  });

  it.each([
    ["LIMITLESS_RELAY_SIGNER_MISMATCH", { signer: "0x2222222222222222222222222222222222222222" }],
    ["LIMITLESS_RELAY_ACCOUNT_MISMATCH", { account: "0x2222222222222222222222222222222222222222" }],
    ["LIMITLESS_RELAY_TOKEN_MISMATCH", { tokenId: "987654321" }],
    ["LIMITLESS_RELAY_SIDE_MISMATCH", { side: Side.SELL }],
    ["LIMITLESS_RELAY_FOK_TAKER_AMOUNT_INVALID", { orderOverrides: { takerAmount: 420000 } }]
  ])("rejects user-signed relay payload drift: %s", async (reasonCode, signedOverrides) => {
    const adapter = new LimitlessExecutionAdapter(userSignedRelayLiveConfig, undefined, {
      async submitSignedOrder() {
        throw new Error("should not relay");
      }
    });
    const prepared = await adapter.prepareOrder(leg());
    prepared.payload = {
      ...(prepared.payload as Record<string, unknown>),
      relayPayload: await limitlessRelayPayload(signedOverrides)
    };

    await expect(adapter.submitOrder(prepared)).rejects.toMatchObject({ reasonCode });
  });

  it("rejects expired prepared user-signed relay orders", async () => {
    const adapter = new LimitlessExecutionAdapter(userSignedRelayLiveConfig, undefined, {
      async submitSignedOrder() {
        throw new Error("should not relay");
      }
    });
    const prepared = await adapter.prepareOrder(leg());
    prepared.payload = {
      ...(prepared.payload as Record<string, unknown>),
      expiresAt: "2026-01-01T00:00:00.000Z",
      relayPayload: await limitlessRelayPayload()
    };

    await expect(adapter.submitOrder(prepared)).rejects.toMatchObject({
      reasonCode: "LIMITLESS_PREPARED_ORDER_EXPIRED"
    });
  });

  it("maps Limitless order-status evidence to a verified settlement only when fill and finality are present", () => {
    expect(mapLimitlessOrderStatusToFillState(minedOrderStatus())).toMatchObject({
      status: "FILLED",
      filledSize: "1",
      averagePrice: 0.42
    });

    expect(mapLimitlessOrderStatusToSettlementState(minedOrderStatus(), {
      orderId: "limitless-order-1",
      delegatedProfileId: 12345
    })).toMatchObject({
      status: "SETTLEMENT_VERIFIED",
      evidence: {
        source: "limitless_order_status_batch",
        delegatedProfileScoped: true,
        settlementStatus: "MINED",
        makerMatchesCount: 1,
        fillEvidenceVerified: true,
        settlementEvidenceVerified: true
      }
    });
  });

  it("keeps unmatched Limitless order-status evidence pending instead of marking settlement verified", () => {
    expect(mapLimitlessOrderStatusToFillState(unmatchedOrderStatus())).toMatchObject({
      status: "OPEN",
      filledSize: "0"
    });

    expect(mapLimitlessOrderStatusToSettlementState(unmatchedOrderStatus(), {
      orderId: "limitless-order-1",
      delegatedProfileId: 12345
    })).toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        settlementStatus: "UNMATCHED",
        fillEvidenceVerified: false,
        settlementEvidenceVerified: false
      }
    });
  });

  it("never verifies settlement when Limitless reports failed or reverted finality", () => {
    expect(mapLimitlessOrderStatusToFillState(failedOrderStatus())).toMatchObject({
      status: "FAILED",
      filledSize: "0"
    });

    expect(mapLimitlessOrderStatusToSettlementState(failedOrderStatus(), {
      orderId: "limitless-order-1",
      delegatedProfileId: 12345
    })).toMatchObject({
      status: "SETTLEMENT_UNKNOWN",
      evidence: {
        settlementStatus: "REVERTED",
        fillEvidenceVerified: true,
        settlementEvidenceVerified: false
      }
    });
  });

  it("uses profile-scoped delegated order status when explicit fill/settlement readers are not injected", async () => {
    const client: LimitlessOrderClient = {
      async createOrder() {
        return mockOrderResponse();
      },
      async cancel() {
        return { message: "cancelled" };
      },
      async getOrderStatus(orderId, onBehalfOf) {
        expect(orderId).toBe("limitless-order-1");
        expect(onBehalfOf).toBe(12345);
        return minedOrderStatus();
      }
    };
    const adapter = new LimitlessExecutionAdapter(delegatedLiveConfig, client);

    await expect(adapter.fetchFillState("limitless-order-1")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "1"
    });
    await expect(adapter.fetchSettlementState("limitless-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_VERIFIED",
      evidence: {
        delegatedProfileScoped: true,
        settlementEvidenceVerified: true
      }
    });
  });

  it("fails closed for delegated submit when no linked profile id is present", async () => {
    const adapter = new LimitlessExecutionAdapter({
      ...delegatedLiveConfig,
      delegatedProfileId: undefined
    }, {
      async createOrder() {
        throw new Error("should not submit");
      },
      async cancel() {
        return { message: "cancelled" };
      }
    });

    await expect(adapter.submitOrder(await adapter.prepareOrder(leg()))).rejects.toMatchObject({
      reasonCode: "LIMITLESS_DELEGATED_PROFILE_REQUIRED"
    });
  });

  it("fails closed without a real Limitless status reader", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "backend_signer",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });

    await expect(adapter.fetchFillState("limitless-order-1")).rejects.toMatchObject({
      reasonCode: "LIMITLESS_ENV_INCOMPLETE"
    });
    await expect(adapter.fetchSettlementState("limitless-order-1")).rejects.toMatchObject({
      reasonCode: "LIMITLESS_ENV_INCOMPLETE"
    });
  });

  it("keeps the live-submit harness blocked until every operator gate is set", () => {
    const env: NodeJS.ProcessEnv = {
      LIMITLESS_EXECUTION_MODE: "backend_signer",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "false",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_API_KEY: "server-side-api-key",
      LIMITLESS_EXECUTION_PRIVATE_KEY: "server-side-private-key"
    };

    const plan = evaluateLimitlessLiveSubmitHarness({
      env,
      adapterStatus: getLimitlessExecutionAdapterEnvStatus(env)
    });

    expect(plan.allowed).toBe(false);
    expect(plan.mode).toBe("DRY_RUN_CHECKLIST");
    expect(plan.blockers).toContain("LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED must be true");
    expect(JSON.stringify(plan)).not.toContain("server-side-api-key");
    expect(JSON.stringify(plan)).not.toContain("server-side-private-key");
  });

  it("allows the live-submit harness only after explicit operator confirmation and tiny order config", () => {
    const env: NodeJS.ProcessEnv = {
      LIMITLESS_EXECUTION_MODE: "backend_signer",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_API_KEY: "server-side-api-key",
      LIMITLESS_EXECUTION_PRIVATE_KEY: "server-side-private-key",
      LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM: limitlessLiveSubmitOperatorConfirmation,
      LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID: "limitless-market-slug",
      LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID: "limitless-token-id",
      LIMITLESS_LIVE_SUBMIT_SIDE: "buy",
      LIMITLESS_LIVE_SUBMIT_SIZE: "0.01",
      LIMITLESS_LIVE_SUBMIT_PRICE: "0.5",
      LIMITLESS_LIVE_SUBMIT_MAX_SIZE: "0.05"
    };

    const plan = evaluateLimitlessLiveSubmitHarness({
      env,
      adapterStatus: getLimitlessExecutionAdapterEnvStatus(env)
    });

    expect(plan.allowed).toBe(true);
    expect(plan.mode).toBe("LIVE_SUBMIT_READY");
  });

  it("allows the delegated live-submit harness only with an explicit profile id", () => {
    const env: NodeJS.ProcessEnv = {
      LIMITLESS_EXECUTION_MODE: "delegated_partner_server_wallet",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_PARTNER_ACCOUNT_ENABLED: "true",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID: "partner-token-id",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET: "partner-hmac-secret",
      LIMITLESS_LIVE_SUBMIT_PROFILE_ID: "12345",
      LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM: limitlessLiveSubmitOperatorConfirmation,
      LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID: "limitless-market-slug",
      LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID: "limitless-token-id",
      LIMITLESS_LIVE_SUBMIT_SIDE: "buy",
      LIMITLESS_LIVE_SUBMIT_SIZE: "0.01",
      LIMITLESS_LIVE_SUBMIT_PRICE: "0.5",
      LIMITLESS_LIVE_SUBMIT_MAX_SIZE: "0.05"
    };

    const plan = evaluateLimitlessLiveSubmitHarness({
      env,
      adapterStatus: getLimitlessExecutionAdapterEnvStatus(env)
    });

    expect(plan.allowed).toBe(true);
    expect(plan.safeConfig).toMatchObject({
      executionMode: "delegated_partner_server_wallet",
      delegatedProfileIdConfigured: true
    });
    expect(JSON.stringify(plan)).not.toContain("partner-hmac-secret");
  });

  it("allows the user-signed live-submit harness only with profile, signer, account, and signed payload", async () => {
    const relayPayload = await limitlessRelayPayload();
    const env: NodeJS.ProcessEnv = {
      LIMITLESS_EXECUTION_MODE: "user_signed_backend_relay",
      LIMITLESS_LIVE_EXECUTION_ENABLED: "true",
      LIMITLESS_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_PARTNER_ACCOUNT_ENABLED: "true",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID: "partner-token-id",
      LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET: "partner-hmac-secret",
      LIMITLESS_LIVE_SUBMIT_PROFILE_ID: "12345",
      LIMITLESS_LIVE_SUBMIT_SIGNER_ADDRESS: evmAddress,
      LIMITLESS_LIVE_SUBMIT_ACCOUNT_ADDRESS: evmAddress,
      LIMITLESS_LIVE_SUBMIT_SIGNED_PAYLOAD_JSON: JSON.stringify(relayPayload.signedPayload),
      LIMITLESS_LIVE_SUBMIT_HARNESS_ENABLED: "true",
      LIMITLESS_LIVE_SUBMIT_OPERATOR_CONFIRM: limitlessLiveSubmitOperatorConfirmation,
      LIMITLESS_LIVE_SUBMIT_VENUE_MARKET_ID: "limitless-market-slug",
      LIMITLESS_LIVE_SUBMIT_VENUE_OUTCOME_ID: "limitless-token-id",
      LIMITLESS_LIVE_SUBMIT_SIDE: "buy",
      LIMITLESS_LIVE_SUBMIT_SIZE: "0.01",
      LIMITLESS_LIVE_SUBMIT_PRICE: "0.5",
      LIMITLESS_LIVE_SUBMIT_MAX_SIZE: "0.05"
    };

    const plan = evaluateLimitlessLiveSubmitHarness({
      env,
      adapterStatus: getLimitlessExecutionAdapterEnvStatus(env)
    });

    expect(plan.allowed).toBe(true);
    expect(plan.safeConfig).toMatchObject({
      executionMode: "user_signed_backend_relay",
      delegatedProfileIdConfigured: true
    });
    expect(JSON.stringify(plan)).not.toContain("partner-hmac-secret");
    expect(JSON.stringify(plan)).not.toContain(relayPayload.signedPayload.signature);
  });
});
