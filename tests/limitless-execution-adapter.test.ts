import { describe, expect, it } from "vitest";
import { OrderType, Side, type OrderResponse } from "@limitless-exchange/sdk";
import {
  getLimitlessExecutionAdapterEnvStatus,
  LimitlessExecutionAdapter,
  LimitlessExecutionNotConfiguredError,
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
});
