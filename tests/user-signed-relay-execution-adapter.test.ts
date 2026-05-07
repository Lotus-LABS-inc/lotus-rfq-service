import { describe, expect, it } from "vitest";
import {
  buildOpinionExecutionAdapterConfigFromEnv,
  buildPredictFunExecutionAdapterConfigFromEnv,
  getOpinionExecutionAdapterEnvStatus,
  getPredictFunExecutionAdapterEnvStatus,
  mapPredictOrderStatusToSettlementState,
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
    timestamp: Date.now(),
    pricePerShare: "450000000000000000",
    strategy: "LIMIT",
    slippageBps: "0",
    isFillOrKill: false,
    order: {
      hash: `0x${"b".repeat(64)}`,
      salt: "1",
      maker: predictAccountAddress,
      signer: predictAccountAddress,
      taker: "0x0000000000000000000000000000000000000000",
      tokenId: "venue-outcome-id",
      makerAmount: "450000000000000000",
      takerAmount: "1000000000000000000",
      expiration: "4102444800",
      nonce: "0",
      feeRateBps: "0",
      side: 0,
      signatureType: 0
    }
  },
  ...overrides
});

const signedPayloadWithOrderOverrides = (orderOverrides: Record<string, unknown>): PredictOauthCreateOrderPayload => ({
  ...signedPayload(),
  data: {
    timestamp: Date.now(),
    pricePerShare: "450000000000000000",
    strategy: "LIMIT",
    slippageBps: "0",
    isFillOrKill: false,
    order: {
      hash: `0x${"b".repeat(64)}`,
      salt: "1",
      maker: predictAccountAddress,
      signer: predictAccountAddress,
      taker: "0x0000000000000000000000000000000000000000",
      tokenId: "venue-outcome-id",
      makerAmount: "450000000000000000",
      takerAmount: "1000000000000000000",
      expiration: "4102444800",
      nonce: "0",
      feeRateBps: "0",
      side: 0,
      signatureType: 0,
      ...orderOverrides
    }
  }
});

const signedPayloadWithDataOverrides = (dataOverrides: Record<string, unknown>): PredictOauthCreateOrderPayload => ({
  ...signedPayload(),
  data: {
    ...signedPayload().data,
    ...dataOverrides
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

    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv(env),
      predictOrderMetadataClient: undefined
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    expect(prepared.payload).toMatchObject({
      relayMode: "USER_SIGNED_BACKEND_RELAY",
      adapter: "PredictFunExecutionAdapter",
      orderCreatePath: "/v1/orders",
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

  it("prepares Predict.fun signed relay orders when optional metadata lookup fails", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: {
        async getMarketById() {
          throw new Error("Predict request failed with status 400.");
        },
        async getMarketStatistics() {
          throw new Error("Predict request failed with status 400.");
        }
      }
    });

    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    expect(prepared.payload).toMatchObject({
      venue: "PREDICT_FUN",
      backendMayRelaySignedPayload: true,
      predictOrderMetadata: {
        chainId: "56",
        feeRateBps: "0",
        isNegRisk: false,
        isYieldBearing: false
      }
    });
  });

  it("resolves Predict.fun shared-core YES/NO labels before preparing typed data", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: {
        async getMarketById(marketId) {
          expect(marketId).toBe("14347");
          return {
            id: "14347",
            outcomes: [
              { label: "Yes", tokenId: "111111111111111111111111111111111111111111111111111111111111111111" },
              { label: "No", tokenId: "222222222222222222222222222222222222222222222222222222222222222222" }
            ]
          };
        },
        async getMarketStatistics() {
          return { feeRateBps: "0" };
        }
      }
    });
    const prepared = await adapter.prepareOrder({
      ...leg("PREDICT_FUN"),
      venueMarketId: "PREDICT:14347:CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH|ABOVE|300000000|300M",
      venueOutcomeId: "NO"
    });

    expect(prepared.payload).toMatchObject({
      venueMarketId: "14347",
      venueOutcomeId: "222222222222222222222222222222222222222222222222222222222222222222",
      expectedOrder: {
        venueMarketId: "14347",
        venueOutcomeId: "222222222222222222222222222222222222222222222222222222222222222222"
      }
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
      predictOrderMetadataClient: undefined,
      predictJwtProvider: { getPredictFunJwt: () => "predict-user-jwt" },
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, {
      signer: "0x0000000000000000000000000000000000000001"
    }))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_SIGNER_MISMATCH"
    });
  });

  it("relays a full Predict.fun order payload without exposing the server API key", async () => {
    let createCalled = false;
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: undefined,
      predictJwtProvider: { getPredictFunJwt: () => "predict-user-jwt" },
      predictOauthOrderClient: {
        configured: () => true,
        async createOauthOrder(input, jwt) {
          createCalled = true;
          expect(jwt).toBe("predict-user-jwt");
          expect(input.data).toMatchObject({
            timestamp: expect.any(Number),
            pricePerShare: "450000000000000000",
            strategy: "LIMIT",
            order: {
              hash: `0x${"b".repeat(64)}`,
              tokenId: "venue-outcome-id",
              makerAmount: "450000000000000000",
              takerAmount: "1000000000000000000",
              signatureType: 0
            }
          });
          expect(JSON.stringify(input)).not.toContain("server-side-predict-key");
          return {
            orderId: "predict-order-id-1",
            orderHash: "predict-order-hash-1"
          };
        },
        async getOrderByHash(orderHash) {
          return {
            orderHash,
            status: "OPEN",
            size: "0",
            remainingSize: "0",
            price: "0",
            raw: {}
          };
        }
      }
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared))).resolves.toMatchObject({
      venueOrderId: "predict-order-hash-1",
      fillId: "predict-order-id-1",
      status: "SUBMITTED"
    });
    expect(createCalled).toBe(true);
  });

  it("rejects Predict.fun relay submit when signed price or size differs from the prepared order", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: undefined,
      predictJwtProvider: { getPredictFunJwt: () => "predict-user-jwt" },
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder(leg("PREDICT_FUN"));

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithDataOverrides({
      pricePerShare: "460000000000000000"
    })))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_PRICE_MISMATCH"
    });
    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithOrderOverrides({
      takerAmount: "2000000000000000000"
    })))).rejects.toMatchObject({
      reasonCode: "USER_SIGNED_RELAY_SIZE_MISMATCH"
    });
  });

  it("accepts Predict.fun SDK quantity truncation when it is within the narrow rounding tolerance", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: undefined,
      predictJwtProvider: { getPredictFunJwt: () => "predict-user-jwt" },
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder({
      ...leg("PREDICT_FUN"),
      size: "2.57732",
      price: 0.389
    });

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithDataOverrides({
      pricePerShare: "389000000000000000",
      order: {
        ...signedPayload().data.order,
        tokenId: "venue-outcome-id",
        makerAmount: "1002550000000000000",
        takerAmount: "2577300000000000000"
      }
    })))).resolves.toMatchObject({
      status: "SUBMITTED"
    });
  });

  it("accepts Predict.fun MARKET order price within the bounded live orderbook tolerance", async () => {
    const adapter = new PredictFunExecutionAdapter({
      ...buildPredictFunExecutionAdapterConfigFromEnv({
        PREDICT_FUN_EXECUTION_MODE: "user_signed_backend_relay",
        PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
        PREDICT_API_KEY: "server-side-predict-key",
        PREDICT_FUN_LIVE_EXECUTION_ENABLED: "true"
      }),
      predictOrderMetadataClient: undefined,
      predictJwtProvider: { getPredictFunJwt: () => "predict-user-jwt" },
      predictOauthOrderClient: mockPredictOrderClient()
    });
    const prepared = await adapter.prepareOrder({
      ...leg("PREDICT_FUN"),
      price: 0.388,
      size: "2.57732"
    });

    await expect(adapter.submitOrder(attachPredictRelayPayload(prepared, signedPayloadWithDataOverrides({
      pricePerShare: "389000000000000000",
      strategy: "MARKET",
      order: {
        ...signedPayload().data.order,
        tokenId: "venue-outcome-id",
        makerAmount: "1002550000000000000",
        takerAmount: "2577300000000000000"
      }
    })))).resolves.toMatchObject({
      status: "SUBMITTED"
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
    await expect(adapter.fetchFillState("predict-order-hash-1")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "1"
    });
    expect(mapPredictOrderStatusToSettlementState({
      orderHash: "predict-order-hash-1",
      status: "SETTLED",
      size: "1",
      remainingSize: "0",
      price: "0.45",
      raw: { account: predictAccountAddress }
    }, {
      userId: "polymarket-funding-test-user",
      signerAddress: walletAddress,
      venueAccountAddress: predictAccountAddress
    })).toMatchObject({
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
    expect(mapPredictOrderStatusToSettlementState({
      orderHash: "predict-order-hash-1",
      status: "COMPLETED",
      size: "1",
      remainingSize: "0",
      price: "0.45",
      raw: {}
    }, {
      userId: "polymarket-funding-test-user",
      signerAddress: walletAddress,
      venueAccountAddress: predictAccountAddress
    })).toMatchObject({
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
