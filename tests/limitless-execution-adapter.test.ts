import { describe, expect, it } from "vitest";
import { OrderType, Side, type OrderResponse } from "@limitless-exchange/sdk";
import {
  getLimitlessExecutionAdapterEnvStatus,
  LimitlessExecutionAdapter,
  LimitlessExecutionNotConfiguredError,
  mapLimitlessOrderStatusToFillState,
  mapLimitlessOrderStatusToSettlementState,
  type LimitlessOrderClient
} from "../src/execution-system/limitless-execution-adapter.js";
import {
  evaluateLimitlessLiveSubmitHarness,
  limitlessLiveSubmitOperatorConfirmation
} from "../src/execution-system/limitless-live-submit-harness.js";
import type { ExecutionLegV0 } from "../src/execution-system/types.js";

const leg = (): ExecutionLegV0 => ({
  executionLegId: "execution-1-leg-1",
  parentExecutionId: "execution-1",
  venue: "LIMITLESS",
  venueMarketId: "limitless-market-slug",
  venueOutcomeId: "limitless-token-id",
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
    tokenId: "limitless-token-id",
    side: Side.BUY,
    feeRateBps: 0,
    nonce: 0,
    signature: "0xsig",
    orderType: "GTC",
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
        tokenId: "limitless-token-id",
        side: Side.BUY,
        size: 1,
        price: 0.42,
        orderType: OrderType.GTC
      }
    });
    expect(JSON.stringify(prepared)).not.toContain("private");
    expect(JSON.stringify(prepared)).not.toContain("api-key");
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

  it("maps mocked live order creation to a submitted venue result", async () => {
    const client: LimitlessOrderClient = {
      async createOrder(input) {
        expect(input).toMatchObject({
          marketSlug: "limitless-market-slug",
          tokenId: "limitless-token-id",
          side: Side.BUY,
          price: 0.42,
          size: 1,
          orderType: OrderType.GTC
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
          tokenId: "limitless-token-id",
          side: Side.BUY,
          price: 0.42,
          size: 1,
          orderType: OrderType.GTC,
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

  it("does not claim settlement verification without a reviewed settlement evidence reader", async () => {
    const adapter = new LimitlessExecutionAdapter({
      executionMode: "backend_signer",
      baseUrl: "https://api.limitless.exchange",
      liveExecutionEnabled: false
    });

    await expect(adapter.fetchSettlementState("limitless-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        settlementEvidenceSupported: false
      }
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
});
