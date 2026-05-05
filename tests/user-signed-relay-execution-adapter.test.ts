import { describe, expect, it } from "vitest";
import {
  buildOpinionExecutionAdapterConfigFromEnv,
  buildPredictFunExecutionAdapterConfigFromEnv,
  getOpinionExecutionAdapterEnvStatus,
  getPredictFunExecutionAdapterEnvStatus,
  OpinionExecutionAdapter,
  PredictFunExecutionAdapter,
  type PredictOauthOrderRelayClient,
  UserSignedRelayExecutionNotConfiguredError
} from "../src/execution-system/user-signed-relay-execution-adapter.js";
import type {
  PredictOauthCreateOrderPayload,
  PredictOauthOrderStatus
} from "../src/integrations/predict/predict-oauth-order-client.js";
import type { ExecutionLegV0 } from "../src/execution-system/types.js";

const leg = (venue: "OPINION" | "PREDICT_FUN"): ExecutionLegV0 => ({
  executionLegId: `${venue.toLowerCase()}-execution-leg-1`,
  parentExecutionId: `${venue.toLowerCase()}-execution-1`,
  venue,
  venueMarketId: "venue-market-id",
  venueOutcomeId: "venue-outcome-id",
  side: "buy",
  size: "1",
  price: 0.45,
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

const walletAddress = "0xD1059eC5F635712f6dcEAd569a41dFD7970DAffa";
const predictAccountAddress = "0x42AfFF0c9366Eb1862b42A5758437CF26c3B76B9";
const signature = `0x${"a".repeat(130)}`;

const signedPayload = (overrides: Partial<PredictOauthCreateOrderPayload> = {}): PredictOauthCreateOrderPayload => ({
  signer: walletAddress,
  account: predictAccountAddress,
  signature,
  data: {
    order: {
      maker: predictAccountAddress,
      signer: predictAccountAddress,
      tokenId: "venue-outcome-id",
      side: 0,
      price: "0.45",
      size: "1"
    }
  },
  ...overrides
});

const signedPayloadWithOrderOverrides = (orderOverrides: Record<string, unknown>): PredictOauthCreateOrderPayload => ({
  ...signedPayload(),
  data: {
    order: {
      maker: predictAccountAddress,
      signer: predictAccountAddress,
      tokenId: "venue-outcome-id",
      side: 0,
      price: "0.45",
      size: "1",
      ...orderOverrides
    }
  }
});

const attachPredictRelayPayload = (
  prepared: Awaited<ReturnType<PredictFunExecutionAdapter["prepareOrder"]>>,
  overrides: Partial<PredictOauthCreateOrderPayload> = {}
) => ({
  ...prepared,
  payload: {
    ...prepared.payload,
    expectedBinding: {
      userId: "polymarket-funding-test-user",
      signerAddress: walletAddress,
      venueAccountId: "predict-account",
      venueAccountAddress: predictAccountAddress
    },
    signedPayload: signedPayload(overrides)
  }
});

const mockPredictOrderClient = (status?: Partial<PredictOauthOrderStatus>): PredictOauthOrderRelayClient => ({
  configured: () => true,
  async createOauthOrder(input) {
    expect(input.signer).toBe(walletAddress);
    expect(input.account).toBe(predictAccountAddress);
    expect(JSON.stringify(input)).not.toContain("server-side-predict-key");
    return {
      orderId: "predict-order-id-1",
      orderHash: "predict-order-hash-1"
    };
  },
  async getOrderByHash(orderHash) {
    return {
      orderHash,
      status: "FILLED",
      size: "1",
      remainingSize: "0",
      price: "0.45",
      raw: {},
      ...status
    };
  }
});

describe("user-signed backend relay execution adapters", () => {
  it("keeps Opinion disabled by default", () => {
    const status = getOpinionExecutionAdapterEnvStatus({
      OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
      OPINION_API_KEY: "server-side-opinion-key",
      OPINION_LIVE_EXECUTION_ENABLED: "false"
    });

    expect(status).toMatchObject({
      adapter: "OpinionExecutionAdapter",
      venue: "OPINION",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      featureFlagSelected: false,
      liveExecutionEnabled: false,
      readinessState: "NOT_CONFIGURED",
      relayImplementationStatus: "PREPARE_ONLY"
    });
  });

  it("prepares frontend-safe Opinion user signing instructions when relay mode is selected", async () => {
    const adapter = new OpinionExecutionAdapter(buildOpinionExecutionAdapterConfigFromEnv({
      OPINION_EXECUTION_MODE: "user_signed_backend_relay",
      OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
      OPINION_API_KEY: "server-side-opinion-key",
      OPINION_LIVE_EXECUTION_ENABLED: "false"
    }));

    const prepared = await adapter.prepareOrder(leg("OPINION"));

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      adapter: "OpinionExecutionAdapter",
      backendMayRelaySignedPayload: false,
      backendMaySign: false,
      signingRequired: true,
      venueMarketId: "venue-market-id",
      venueOutcomeId: "venue-outcome-id",
      price: 0.45,
      size: 1
    });
    const serialized = JSON.stringify(prepared);
    expect(serialized).not.toContain("server-side-opinion-key");
  });

  it("reports Predict.fun signed relay implementation while live relay remains operator-gated", async () => {
    const env = {
      PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
      PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
      PREDICT_API_KEY: "server-side-predict-key",
      PREDICT_FUN_LIVE_EXECUTION_ENABLED: "false"
    };
    const status = getPredictFunExecutionAdapterEnvStatus(env);
    expect(status).toMatchObject({
      adapter: "PredictFunExecutionAdapter",
      venue: "PREDICT_FUN",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      readinessState: "LIVE_DISABLED",
      relayImplementationStatus: "SIGNED_RELAY_IMPLEMENTED"
    });

    const adapter = new PredictFunExecutionAdapter(buildPredictFunExecutionAdapterConfigFromEnv(env));
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      adapter: "PredictFunExecutionAdapter",
      orderCreatePath: "/v1/oauth/orders/create",
      backendMayRelaySignedPayload: true,
      backendMaySign: false,
      expectedOrder: {
        venueMarketId: "venue-market-id",
        venueOutcomeId: "venue-outcome-id",
        side: "buy",
        size: 1,
        price: 0.45
      }
    });
    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_LIVE_DISABLED"
    });
  });

  it("rejects Predict.fun relay submit when the signer does not match the active Turnkey wallet", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, {
      signer: "0x0000000000000000000000000000000000000001"
    }))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_SIGNER_MISMATCH"
    });
  });

  it("relays a validated Predict.fun signed order without exposing the server API key", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));
    const submitted = await adapter.submitOrder(attachPredictRelayPayload(prepared));

    expect(submitted).toEqual({
      venueOrderId: "predict-order-hash-1",
      fillId: "predict-order-id-1",
      status: "SUBMITTED",
      filledSize: "0",
      averagePrice: 0.45
    });
    expect(JSON.stringify(submitted)).not.toContain("server-side-predict-key");
    await expect(adapter.fetchFillState("predict-order-hash-1")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "1",
      averagePrice: 0.45,
      offchainFilled: true
    });
    await expect(adapter.fetchSettlementState("predict-order-hash-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        settlementEvidenceSupported: true,
        orderStatus: "FILLED",
        reason: "fill_seen_waiting_for_final_settlement_status"
      }
    });
  });

  it("rejects Predict.fun relay submit when signed price or size differs from the prepared order", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithOrderOverrides({
      price: "0.46"
    })))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_PRICE_MISMATCH"
    });
    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithOrderOverrides({
      size: "2"
    })))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_SIZE_MISMATCH"
    });
  });

  it("maps Predict.fun status and settlement evidence conservatively", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOauthOrderClient: mockPredictOrderClient({
        status: "SETTLED",
        raw: { account: predictAccountAddress }
      })
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));
    await adapter.submitOrder(attachPredictRelayPayload(prepared));

    await expect(adapter.fetchFillState("predict-order-hash-1")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "1"
    });
    await expect(adapter.fetchSettlementState("predict-order-hash-1")).resolves.toMatchObject({
      status: "SETTLEMENT_VERIFIED",
      evidence: {
        settlementEvidenceSupported: true,
        orderStatus: "SETTLED",
        accountEvidenceMatched: true,
        finalityEvidence: "predict_final_status_zero_remaining_matching_account"
      }
    });
  });

  it("does not verify Predict.fun settlement when final status lacks matching account evidence", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOauthOrderClient: mockPredictOrderClient({
        status: "COMPLETED",
        raw: {}
      })
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));
    await adapter.submitOrder(attachPredictRelayPayload(prepared));

    await expect(adapter.fetchSettlementState("predict-order-hash-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        orderStatus: "COMPLETED",
        accountEvidenceMatched: false,
        reason: "account_evidence_missing_or_mismatched"
      }
    });
  });

  it("maps Predict.fun open, partial, cancelled, and failed fill statuses without settlement credit", async () => {
    for (const [providerStatus, expectedFillStatus] of [
      ["OPEN", "OPEN"],
      ["PARTIALLY_FILLED", "PARTIAL_FILL"],
      ["CANCELLED", "CANCELLED"],
      ["REJECTED", "FAILED"]
    ] as const) {
      const adapter = new PredictFunExecutionAdapter({
        ...buildPredictFunExecutionAdapterConfigFromEnv({
          PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
          PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
          PREDICT_API_KEY: "server-side-predict-key",
          PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
        }),
        predictOauthOrderClient: mockPredictOrderClient({
          status: providerStatus,
          size: "4",
          remainingSize: providerStatus === "PARTIALLY_FILLED" ? "1" : "4",
          raw: { account: predictAccountAddress }
        })
      });
      const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));
      await adapter.submitOrder(attachPredictRelayPayload(prepared));

      await expect(adapter.fetchFillState("predict-order-hash-1")).resolves.toMatchObject({
        status: expectedFillStatus
      });
      await expect(adapter.fetchSettlementState("predict-order-hash-1")).resolves.not.toMatchObject({
        status: "SETTLEMENT_VERIFIED"
      });
    }
  });

  it("does not claim settlement verification for relay venues", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "false"
      }),
      predictOauthOrderClient: {
        configured: () => false,
        async createOauthOrder() {
          throw new Error("not configured");
        },
        async getOrderByHash() {
          throw new Error("not configured");
        }
      }
    });

    await expect(adapter.fetchSettlementState("predict-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_PENDING",
      evidence: {
        settlementEvidenceSupported: false
      }
    });
  });
});
