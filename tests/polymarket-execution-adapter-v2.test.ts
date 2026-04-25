import { describe, expect, it } from "vitest";
import { Side } from "@polymarket/clob-client-v2";

import type { ExecutionScopeBinding } from "../src/execution-control/execution-scope-token.js";
import {
  AccountingUpdateService,
  ApprovedLaneExecutionGate,
  ExecutionFeeService,
  ExecutionPreflightService,
  ExecutionSystemOrchestrator,
  ExecutionVenueAdapterRegistry,
  FallbackPolicyService,
  GhostFillProtectionService,
  DisabledPolymarketClobV2LiveClient,
  InMemoryExecutionAuditSink,
  PolymarketClobV2DryRunClient,
  PolymarketExecutionAdapterV2,
  SdkPolymarketClobV2LiveClient,
  SettlementVerificationService,
  StaticLaneAuthorityResolver,
  TestExecutionAdapter,
  getPolymarketExecutionAdapterV2EnvStatus,
  mapPolymarketV2SettlementState,
  zeroFees,
  type ExecutionLaneAuthoritySnapshot,
  type ExecutionLegV0,
  type ExecutionRequestV0,
  type PolymarketClobV2SdkClient
} from "../src/execution-system/index.js";

const completeEnv = {
  POLYMARKET_EXECUTION_MODE: "v2",
  POLYMARKET_LIVE_EXECUTION_ENABLED: "true",
  POLY_CLOB_HOST: "https://clob.polymarket.test",
  POLY_CHAIN_ID: "137",
  POLY_API_KEY: "server-side-key",
  POLY_API_SECRET: "server-side-secret",
  POLY_API_PASSPHRASE: "server-side-passphrase",
  POLY_BUILDER_CODE: "lotus-builder",
  POLY_PRIVATE_KEY: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f"
};

const leg = (): ExecutionLegV0 => ({
  executionLegId: "execution-1-leg-1",
  parentExecutionId: "execution-1",
  venue: "POLYMARKET",
  venueMarketId: "pm-market-1",
  venueOutcomeId: "pm-outcome-yes",
  side: "buy",
  size: "1",
  price: 0.51,
  status: "CREATED",
  settlementStatus: "SETTLEMENT_PENDING"
});

const approvedLane: ExecutionLaneAuthoritySnapshot = {
  laneId: "CRYPTO_BTC_ATH_BY_DATE_SINGLE_POLYMARKET",
  laneState: "OPERATOR_APPROVED_SANDBOX",
  topicKey: "CRYPTO|ATH_BY_DATE|BTC",
  venueSet: ["POLYMARKET"],
  candidateSet: ["2026-06-30"],
  ruleState: "EXACT_SAFE"
};

const scopeBinding: ExecutionScopeBinding = {
  scopeKind: "CRYPTO_LANE",
  scopeId: approvedLane.laneId,
  topicKey: approvedLane.topicKey,
  laneType: "SINGLE",
  venueSet: approvedLane.venueSet,
  candidateSet: approvedLane.candidateSet,
  canonicalMarketId: "canonical-market-1"
};

const request = (patch: Partial<ExecutionRequestV0> = {}): ExecutionRequestV0 => ({
  executionId: "execution-1",
  rfqId: "rfq-1",
  userId: "user-1",
  canonicalTopicKey: approvedLane.topicKey,
  candidateId: "2026-06-30",
  side: "buy",
  size: "1",
  selectedLaneId: approvedLane.laneId,
  venuePath: ["POLYMARKET"],
  executionMode: "SINGLE_VENUE",
  approvedScopeHash: "scope-hash-1",
  maxSlippage: 0.01,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.51,
  expectedFees: zeroFees(),
  idempotencyKey: "idem-1",
  createdAt: "2026-04-24T00:00:00.000Z",
  executionScopeToken: "token-1",
  ...patch
});

const buildOrchestrator = (input: {
  adapter: PolymarketExecutionAdapterV2 | TestExecutionAdapter;
  lane?: ExecutionLaneAuthoritySnapshot;
  audit?: InMemoryExecutionAuditSink;
}) => {
  const lane = input.lane ?? approvedLane;
  const laneGate = new ApprovedLaneExecutionGate(
    new StaticLaneAuthorityResolver(new Map([[lane.laneId, lane]]))
  );
  const adapters = new ExecutionVenueAdapterRegistry();
  adapters.register(input.adapter);
  const audit = input.audit ?? new InMemoryExecutionAuditSink();
  return {
    audit,
    orchestrator: new ExecutionSystemOrchestrator({
      preflight: new ExecutionPreflightService({
        laneGate,
        venueHealth: { isVenueHealthy: async () => true },
        marketState: { isMarketOpen: async () => true, isOutcomePresent: async () => true },
        liquidity: { hasLiquidity: async () => true },
        funding: { hasFunding: async () => true },
        idempotency: { isAlreadyCompleted: async () => false },
        price: { isWithinSlippage: async () => true }
      }),
      adapters,
      settlement: new SettlementVerificationService(adapters, { timeoutMs: 1, pollIntervalMs: 1, maxAttempts: 1 }),
      ghostFill: new GhostFillProtectionService(),
      fallback: new FallbackPolicyService(laneGate),
      accounting: new AccountingUpdateService(),
      fees: new ExecutionFeeService(),
      audit
    })
  };
};

describe("PolymarketExecutionAdapterV2", () => {
  it("reports disabled mode and fails closed without preparing an order", async () => {
    const adapter = new PolymarketExecutionAdapterV2({
      executionMode: "disabled",
      liveExecutionEnabled: false
    });
    expect(adapter.status()).toMatchObject({
      featureFlagSelected: false,
      liveExecutionEnabled: false,
      readinessState: "NOT_CONFIGURED",
      liveSubmissionStatus: "NOT_CONFIGURED"
    });
    await expect(adapter.prepareOrder(leg())).rejects.toMatchObject({
      reasonCode: "POLYMARKET_V2_MODE_NOT_SELECTED"
    });
  });

  it("returns env incomplete status and fails closed when live flag is enabled without complete env", async () => {
    const status = getPolymarketExecutionAdapterV2EnvStatus({
      POLYMARKET_EXECUTION_MODE: "v2",
      POLYMARKET_LIVE_EXECUTION_ENABLED: "true"
    });
    expect(status.readinessState).toBe("NOT_CONFIGURED");
    expect(status.liveSubmissionStatus).toBe("NOT_CONFIGURED");
    expect(status.missingEnv).toContain("POLYMARKET_API_SECRET");
    expect(status.missingDryRunEnv).toContain("POLYMARKET_BUILDER_CODE");

    const adapter = new PolymarketExecutionAdapterV2({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: "https://clob.polymarket.test"
    });
    await expect(adapter.prepareOrder(leg())).rejects.toMatchObject({
      reasonCode: "POLYMARKET_V2_NOT_CONFIGURED"
    });
  });

  it("prepares a safe dry-run order envelope with builderCode while live execution is disabled", async () => {
    const adapter = new PolymarketExecutionAdapterV2({
      executionMode: "v2",
      liveExecutionEnabled: false,
      clobHost: completeEnv.POLY_CLOB_HOST,
      chainId: completeEnv.POLY_CHAIN_ID,
      builderCode: completeEnv.POLY_BUILDER_CODE
    });
    expect(adapter.status()).toMatchObject({
      readinessState: "LIVE_DISABLED",
      liveSubmissionStatus: "LIVE_DISABLED",
      dryRunRequiredEnvPresent: true
    });
    const prepared = await adapter.prepareOrder(leg());
    expect(prepared.payload).toMatchObject({
      venueMarketId: "pm-market-1",
      venueOutcomeId: "pm-outcome-yes",
      metadata: {
        adapter: "PolymarketExecutionAdapterV2",
        readinessState: "LIVE_DISABLED",
        clobV2DryRun: {
          adapter: "PolymarketExecutionAdapterV2",
          dryRun: true,
          marketId: "pm-market-1",
          outcomeId: "pm-outcome-yes",
          side: Side.BUY,
          size: "1",
          price: "0.5100",
          builderCode: "lotus-builder",
          chainId: "137",
          clobHost: "https://clob.polymarket.test"
        }
      }
    });
    const dryRun = (prepared.payload.metadata as { clobV2DryRun: { orderHash: string; orderDigest: string; createdAt: string } }).clobV2DryRun;
    expect(dryRun.orderHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dryRun.orderDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(dryRun.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(prepared.payload)).not.toContain("server-side-secret");
    expect(JSON.stringify(prepared.payload)).not.toContain("server-side-passphrase");
    expect(JSON.stringify(prepared.payload)).not.toContain("server-side-key");
  });

  it("dry-run client validates signing and order payload shape without exposing credentials", () => {
    const client = new PolymarketClobV2DryRunClient({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: completeEnv.POLY_CLOB_HOST,
      chainId: completeEnv.POLY_CHAIN_ID,
      apiKey: completeEnv.POLY_API_KEY,
      apiSecret: completeEnv.POLY_API_SECRET,
      apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
      builderCode: completeEnv.POLY_BUILDER_CODE
    });
    const envelope = client.buildOrderEnvelope({
      clientOrderId: "client-order-1",
      venueMarketId: "pm-market-1",
      venueOutcomeId: "token-yes",
      side: "sell",
      size: "2.5",
      price: 0.42
    });
    expect(envelope.validation).toMatchObject({
      dryRunOnly: true,
      submitAllowed: false,
      shapeValid: true,
      blockers: []
    });
    expect(envelope.request.body).toMatchObject({
      side: "SELL",
      size: "2.5",
      price: "0.4200",
      builder_code: "lotus-builder",
      chain_id: "137"
    });
    expect(envelope.signing.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.signing.preimageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.signing.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(envelope)).not.toContain("server-side-secret");
    expect(JSON.stringify(envelope)).not.toContain("server-side-passphrase");
    expect(JSON.stringify(envelope)).not.toContain("server-side-key");
  });

  it("dry-run client reports blockers for invalid order shape", () => {
    const client = new PolymarketClobV2DryRunClient({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: "not-a-url",
      chainId: "polygon",
      apiKey: "",
      apiSecret: "",
      apiPassphrase: "",
      builderCode: ""
    });
    const envelope = client.buildOrderEnvelope({
      clientOrderId: "",
      venueMarketId: "",
      venueOutcomeId: "",
      side: "buy",
      size: "0",
      price: 0
    });
    expect(envelope.validation.shapeValid).toBe(false);
    expect(envelope.validation.blockers).toEqual(expect.arrayContaining([
      "invalid_clob_host",
      "invalid_chain_id",
      "missing_api_secret",
      "missing_builder_code",
      "invalid_size",
      "invalid_price"
    ]));
  });

  it("uses POLYMARKET_* env names and still supports legacy POLY_* aliases", () => {
    expect(getPolymarketExecutionAdapterV2EnvStatus({
      POLYMARKET_EXECUTION_MODE: "v2",
      POLYMARKET_LIVE_EXECUTION_ENABLED: "false",
      POLYMARKET_CLOB_HOST: completeEnv.POLY_CLOB_HOST,
      POLYMARKET_CHAIN_ID: completeEnv.POLY_CHAIN_ID,
      POLYMARKET_BUILDER_CODE: completeEnv.POLY_BUILDER_CODE
    })).toMatchObject({
      readinessState: "LIVE_DISABLED",
      dryRunRequiredEnvPresent: true,
      missingDryRunEnv: []
    });

    expect(getPolymarketExecutionAdapterV2EnvStatus({
      POLYMARKET_EXECUTION_MODE: "v2",
      POLYMARKET_LIVE_EXECUTION_ENABLED: "false",
      POLY_CLOB_HOST: completeEnv.POLY_CLOB_HOST,
      POLY_CHAIN_ID: completeEnv.POLY_CHAIN_ID,
      POLY_BUILDER_CODE: completeEnv.POLY_BUILDER_CODE
    })).toMatchObject({
      readinessState: "LIVE_DISABLED",
      dryRunRequiredEnvPresent: true,
      missingDryRunEnv: []
    });
  });

  it("depends on a disabled live client contract and cannot submit accidentally even with complete env", async () => {
    const liveClient = new DisabledPolymarketClobV2LiveClient();
    const adapter = new PolymarketExecutionAdapterV2({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: completeEnv.POLY_CLOB_HOST,
      chainId: completeEnv.POLY_CHAIN_ID,
      apiKey: completeEnv.POLY_API_KEY,
      apiSecret: completeEnv.POLY_API_SECRET,
      apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
      builderCode: completeEnv.POLY_BUILDER_CODE,
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, liveClient);
    expect(adapter.status()).toMatchObject({
      readinessState: "LIVE_READY",
      liveSubmissionStatus: "LIVE_CLIENT_DISABLED"
    });
    const prepared = await adapter.prepareOrder(leg());
    await expect(adapter.submitOrder(prepared)).rejects.toMatchObject({
      reasonCode: "POLYMARKET_V2_LIVE_CLIENT_DISABLED"
    });
    expect(liveClient.submitAttempts).toBe(1);
    expect(adapter.normalizeVenueError(
      await adapter.submitOrder(prepared).catch((error: unknown) => error)
    )).toMatchObject({
      code: "VENUE_EXECUTION_NOT_CONFIGURED",
      retryable: false
    });
    expect(liveClient.submitAttempts).toBe(2);
  });

  it("disabled live client exposes deterministic fill, cancel, and dry-run settlement behavior", async () => {
    const liveClient = new DisabledPolymarketClobV2LiveClient();
    await expect(liveClient.submitOrder({ venue: "POLYMARKET", clientOrderId: "client-1", payload: {} }))
      .rejects.toMatchObject({ reasonCode: "POLYMARKET_V2_LIVE_CLIENT_DISABLED" });
    await expect(liveClient.cancelOrder("order-1"))
      .rejects.toMatchObject({ reasonCode: "POLYMARKET_V2_LIVE_CLIENT_DISABLED" });
    await expect(liveClient.fetchFillState("order-1")).resolves.toMatchObject({
      status: "FAILED",
      filledSize: "0",
      offchainFilled: false
    });
    await expect(liveClient.fetchSettlementState("order-1")).resolves.toMatchObject({
      status: "DRY_RUN_ONLY",
      evidence: {
        source: "polymarket_v2_disabled_live_client",
        dryRunOnly: true
      }
    });
  });

  it("SDK live client maps submit, fill, cancel, and settlement through the CLOB V2 contract", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder(userOrder, options, orderType) {
        calls.push({ method: "createAndPostOrder", args: [userOrder, options, orderType] });
        return {
          orderID: "pm-order-1",
          status: "MATCHED",
          takingAmount: "1",
          price: "0.51",
          transactionsHashes: ["0xsettlement"]
        };
      },
      async getOrder(orderID) {
        calls.push({ method: "getOrder", args: [orderID] });
        return {
          id: orderID,
          status: "open",
          owner: "owner",
          maker_address: "maker",
          market: "pm-market-1",
          asset_id: "pm-outcome-yes",
          side: Side.BUY,
          original_size: "1",
          size_matched: "0.5",
          price: "0.51",
          associate_trades: ["trade-1"],
          outcome: "Yes",
          created_at: 0,
          expiration: "0",
          order_type: "GTC"
        };
      },
      async getTrades(params) {
        calls.push({ method: "getTrades", args: [params] });
        return [{
          id: "trade-1",
          taker_order_id: "pm-order-1",
          market: "pm-market-1",
          asset_id: "pm-outcome-yes",
          side: Side.BUY,
          size: "1",
          fee_rate_bps: "0",
          price: "0.51",
          status: "confirmed",
          match_time: "2026-04-25T00:00:00.000Z",
          last_update: "2026-04-25T00:00:00.000Z",
          outcome: "Yes",
          bucket_index: 0,
          owner: "owner",
          maker_address: "maker",
          maker_orders: [],
          transaction_hash: "0xsettlement",
          trader_side: "TAKER"
        }];
      },
      async cancelOrder(payload) {
        calls.push({ method: "cancelOrder", args: [payload] });
        return { success: true };
      }
    };
    const client = new SdkPolymarketClobV2LiveClient({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: completeEnv.POLY_CLOB_HOST,
      chainId: completeEnv.POLY_CHAIN_ID,
      apiKey: completeEnv.POLY_API_KEY,
      apiSecret: completeEnv.POLY_API_SECRET,
      apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
      builderCode: completeEnv.POLY_BUILDER_CODE,
      privateKey: completeEnv.POLY_PRIVATE_KEY,
      tickSize: "0.01",
      negRisk: false
    }, () => sdkClient);

    const submitResult = await client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        venueMarketId: "pm-market-1",
        venueOutcomeId: "pm-outcome-yes",
        side: "buy",
        size: "1",
        price: 0.51
      }
    });
    expect(submitResult).toMatchObject({
      venueOrderId: "pm-order-1",
      fillId: "0xsettlement",
      status: "FILLED",
      filledSize: "1"
    });
    expect(calls[0]).toMatchObject({
      method: "createAndPostOrder",
      args: [
        {
          tokenID: "pm-outcome-yes",
          price: 0.51,
          size: 1,
          side: "BUY",
          builderCode: "lotus-builder"
        },
        {
          tickSize: "0.01",
          negRisk: false
        },
        "GTC"
      ]
    });

    await expect(client.fetchFillState("pm-order-1")).resolves.toMatchObject({
      status: "PARTIAL_FILL",
      filledSize: "0.5",
      offchainFilled: true
    });
    await expect(client.cancelOrder("pm-order-1")).resolves.toEqual({ cancelled: true });
    await expect(client.fetchSettlementState("pm-order-1")).resolves.toMatchObject({
      status: "SETTLEMENT_VERIFIED"
    });
  });

  it("redacts SDK auth headers and generated order signatures from failed live-submit logs", async () => {
    const captured: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      captured.push(args);
    };
    try {
      const sdkClient: PolymarketClobV2SdkClient = {
        async createAndPostOrder() {
          console.error("[CLOB Client] request error", {
            headers: {
              POLY_API_KEY: completeEnv.POLY_API_KEY,
              POLY_PASSPHRASE: completeEnv.POLY_API_PASSPHRASE,
              POLY_SIGNATURE: "generated-header-signature"
            },
            data: JSON.stringify({
              owner: completeEnv.POLY_API_KEY,
              order: {
                signature: "0xgeneratedordersignature"
              }
            })
          });
          const error = new Error("Unauthorized/Invalid api key");
          Object.assign(error, { status: 401 });
          throw error;
        },
        async getOrder() {
          throw new Error("not used");
        },
        async getTrades() {
          return [];
        },
        async cancelOrder() {
          return { success: false };
        }
      };
      const client = new SdkPolymarketClobV2LiveClient({
        executionMode: "v2",
        liveExecutionEnabled: true,
        clobHost: completeEnv.POLY_CLOB_HOST,
        chainId: completeEnv.POLY_CHAIN_ID,
        apiKey: completeEnv.POLY_API_KEY,
        apiSecret: completeEnv.POLY_API_SECRET,
        apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
        builderCode: completeEnv.POLY_BUILDER_CODE,
        privateKey: completeEnv.POLY_PRIVATE_KEY
      }, () => sdkClient);
      await expect(client.submitOrder({
        venue: "POLYMARKET",
        clientOrderId: "execution-1-leg-1",
        payload: {
          venueMarketId: "pm-market-1",
          venueOutcomeId: "pm-outcome-yes",
          side: "buy",
          size: "1",
          price: 0.51
        }
      })).rejects.toMatchObject({ reasonCode: "POLYMARKET_V2_UNAUTHORIZED" });
    } finally {
      console.error = originalError;
    }
    const output = JSON.stringify(captured);
    expect(output).not.toContain(completeEnv.POLY_API_KEY);
    expect(output).not.toContain(completeEnv.POLY_API_PASSPHRASE);
    expect(output).not.toContain(completeEnv.POLY_API_SECRET);
    expect(output).not.toContain("generated-header-signature");
    expect(output).not.toContain("0xgeneratedordersignature");
    expect(output).toContain("<redacted>");
  });

  it("maps settlement states for verified, pending, timeout, suspected, and confirmed outcomes", () => {
    expect(mapPolymarketV2SettlementState({ settlementStatus: "settled" }).status).toBe("SETTLEMENT_VERIFIED");
    expect(mapPolymarketV2SettlementState({ settlementStatus: "pending" }).status).toBe("SETTLEMENT_PENDING");
    expect(mapPolymarketV2SettlementState({ settlementStatus: "timeout" }).status).toBe("SETTLEMENT_TIMEOUT");
    expect(mapPolymarketV2SettlementState({ ghostFillSuspected: true }).status).toBe("GHOST_FILL_SUSPECTED");
    expect(mapPolymarketV2SettlementState({ ghostFillConfirmed: true }).status).toBe("GHOST_FILL_CONFIRMED");
  });

  it("writes fail-closed audit and does not emit accounting when disabled adapter is used by orchestrator", async () => {
    const audit = new InMemoryExecutionAuditSink();
    const { orchestrator } = buildOrchestrator({
      audit,
      adapter: new PolymarketExecutionAdapterV2({
        executionMode: "disabled",
        liveExecutionEnabled: false
      })
    });
    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.metadata.legs[0]?.errorCode).toBe("POLYMARKET_V2_MODE_NOT_SELECTED");
    expect(audit.events.map((event) => event.eventType)).toContain("FAILED_CLOSED");
    expect(audit.events.map((event) => event.eventType)).not.toContain("ACCOUNTING_UPDATED");
  });

  it("prepares dry-run but fails closed on submit without updating accounting when live is disabled", async () => {
    const audit = new InMemoryExecutionAuditSink();
    const { orchestrator } = buildOrchestrator({
      audit,
      adapter: new PolymarketExecutionAdapterV2({
        executionMode: "v2",
        liveExecutionEnabled: false,
        clobHost: completeEnv.POLY_CLOB_HOST,
        chainId: completeEnv.POLY_CHAIN_ID,
        builderCode: completeEnv.POLY_BUILDER_CODE
      })
    });
    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.filledSize).toBe("0");
    expect(output.metadata.legs[0]?.errorCode).toBe("POLYMARKET_LIVE_EXECUTION_DISABLED");
    expect(audit.events.map((event) => event.eventType)).toContain("FAILED_CLOSED");
    expect(audit.events.map((event) => event.eventType)).not.toContain("ACCOUNTING_UPDATED");
    expect(audit.events.map((event) => event.eventType)).not.toContain("FILL_RECEIVED");
  });

  it("passes settlement timeout into the ghost-fill hook for protected Polymarket fills", async () => {
    const audit = new InMemoryExecutionAuditSink();
    const { orchestrator } = buildOrchestrator({
      audit,
      adapter: new TestExecutionAdapter("POLYMARKET", {
        settlementStatus: "SETTLEMENT_PENDING",
        offchainFilled: true
      })
    });
    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.result.ghostFillStatus).toBe("SUSPECTED");
    expect(output.result.settlementStatus).toBe("GHOST_FILL_SUSPECTED");
    expect(audit.events.map((event) => event.eventType)).toContain("GHOST_FILL_SUSPECTED");
  });

  it("still blocks unapproved lanes before Polymarket adapter submission", async () => {
    const audit = new InMemoryExecutionAuditSink();
    const { orchestrator } = buildOrchestrator({
      audit,
      lane: { ...approvedLane, laneState: "MATCHER_READY" },
      adapter: new PolymarketExecutionAdapterV2({
        executionMode: "v2",
        liveExecutionEnabled: true,
        clobHost: completeEnv.POLY_CLOB_HOST,
        chainId: completeEnv.POLY_CHAIN_ID,
        apiKey: completeEnv.POLY_API_KEY,
        apiSecret: completeEnv.POLY_API_SECRET,
        apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
        builderCode: completeEnv.POLY_BUILDER_CODE
      })
    });
    const output = await orchestrator.execute(request(), { scopeBinding });
    expect(output.result.finalState).toBe("FAILED_CLOSED");
    expect(output.metadata.legs[0]?.status).toBe("CREATED");
    expect(output.metadata.auditEventIds.length).toBeGreaterThan(0);
    expect(audit.events.map((event) => event.eventType)).toContain("PREFLIGHT_FAILED");
    expect(audit.events.map((event) => event.eventType)).not.toContain("ORDER_SUBMITTED");
  });
});
