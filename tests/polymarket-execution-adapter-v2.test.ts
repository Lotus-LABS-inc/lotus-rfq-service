import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AssetType, OrderType, Side, SignatureTypeV2 } from "@polymarket/clob-client-v2";

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
  RelayPolymarketClobV2LiveClient,
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
  type PolymarketClobV2SdkClient,
  type PreparedVenueOrder
} from "../src/execution-system/index.js";
import {
  createPolymarketRelayNonce,
  signPolymarketRelayRequest,
  verifyPolymarketRelayRequest
} from "../src/execution-system/polymarket-execution-relay-auth.js";
import { buildPolymarketExecutionRelayServer } from "../src/polymarket-execution-relay.js";

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

const polymarketPostOrderDiagnosticPath = join(
  process.cwd(),
  "artifacts",
  "execution",
  "polymarket-postorder-rejection-diagnostic.json"
);

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

const diagnosticDepositWallet = "0x1111111111111111111111111111111111111111";
const diagnosticLongTokenId = "12345678901234567890123456789012345678901234567890";

const signedPolymarketVenueOrder = (
  payloadPatch: Record<string, unknown> = {},
  signedOrderPatch: Record<string, unknown> = {}
): PreparedVenueOrder => ({
  venue: "POLYMARKET",
  clientOrderId: "execution-1-leg-1",
  payload: {
    polymarketCollateralReadinessAttestation: {
      kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
      quoteId: "exec_quote_diagnostic",
      legIndex: 0,
      checkedAt: new Date().toISOString(),
      requiredAtomic: "1274970",
      requiredNotional: "1.27497",
      usableBalance: "7.85565",
      usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
      approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
      walletAddress: diagnosticDepositWallet,
      ownerAddress: diagnosticDepositWallet,
      venueAccountAddress: diagnosticDepositWallet
    },
    signedPayload: {
      signature: `0x${"aa".repeat(65)}`,
      data: {
        polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
        order: {
          salt: "1",
          maker: diagnosticDepositWallet,
          signer: diagnosticDepositWallet,
          tokenId: diagnosticLongTokenId,
          makerAmount: "1274970",
          takerAmount: "100000000",
          side: "BUY",
          signatureType: 3,
          timestamp: "1",
          expiration: "0",
          metadata: `0x${"00".repeat(32)}`,
          builder: `0x${"11".repeat(32)}`,
          ...signedOrderPatch
        }
      }
    },
    venueMarketId: "pm-market-1",
    venueOutcomeId: diagnosticLongTokenId,
    side: "buy",
    size: "1.25",
    price: 0.99,
    ...payloadPatch
  }
});

const diagnosticSdkClient = (postOrderError: unknown): PolymarketClobV2SdkClient => ({
  async createAndPostOrder() {
    throw new Error("unsigned createAndPostOrder must not be used");
  },
  async postOrder() {
    throw postOrderError;
  },
  async updateBalanceAllowance() {
    return {};
  },
  async getBalanceAllowance() {
    return { balance: "2000000", allowance: "2000000" };
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
});

const diagnosticSdkClientReturning = (postOrderResponse: unknown): PolymarketClobV2SdkClient => ({
  async createAndPostOrder() {
    throw new Error("unsigned createAndPostOrder must not be used");
  },
  async postOrder() {
    return postOrderResponse;
  },
  async updateBalanceAllowance() {
    return {};
  },
  async getBalanceAllowance() {
    return { balance: "2000000", allowance: "2000000" };
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
});

const diagnosticClient = (sdkClient: PolymarketClobV2SdkClient): SdkPolymarketClobV2LiveClient =>
  new SdkPolymarketClobV2LiveClient({
    executionMode: "v2",
    liveExecutionEnabled: true,
    clobHost: completeEnv.POLY_CLOB_HOST,
    chainId: completeEnv.POLY_CHAIN_ID,
    apiKey: completeEnv.POLY_API_KEY,
    apiSecret: completeEnv.POLY_API_SECRET,
    apiPassphrase: completeEnv.POLY_API_PASSPHRASE,
    builderCode: completeEnv.POLY_BUILDER_CODE,
    privateKey: completeEnv.POLY_PRIVATE_KEY,
    signatureType: "POLY_1271",
    funderAddress: diagnosticDepositWallet,
    tickSize: "0.01",
    negRisk: false
  }, () => sdkClient);

describe("PolymarketExecutionAdapterV2", () => {
  afterEach(() => {
    rmSync(polymarketPostOrderDiagnosticPath, { force: true });
  });

  it("uses the Polymarket V2 SDK, deposit-wallet builder signing SDK, and excludes legacy CLOB package", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    expect(allDeps["@polymarket/clob-client-v2"]).toBeDefined();
    expect(allDeps["@polymarket/clob-client"]).toBeUndefined();
    expect(allDeps["@polymarket/builder-signing-sdk"]).toBeDefined();
    expect(lockfile).toContain('"node_modules/@polymarket/clob-client-v2"');
    expect(lockfile).not.toContain('"node_modules/@polymarket/clob-client"');
    expect(lockfile).toContain('"node_modules/@polymarket/builder-signing-sdk"');
  });

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

  it("treats relay URL and secret as live env in relay submit mode", () => {
    const status = getPolymarketExecutionAdapterV2EnvStatus({
      POLYMARKET_EXECUTION_MODE: "v2",
      POLYMARKET_LIVE_EXECUTION_ENABLED: "true",
      POLYMARKET_EXECUTION_SUBMIT_MODE: "relay",
      POLYMARKET_EXECUTION_RELAY_URL: "https://relay.example",
      POLYMARKET_EXECUTION_RELAY_SECRET: "relay-secret",
      POLYMARKET_CLOB_HOST: "https://clob.polymarket.test",
      POLYMARKET_CHAIN_ID: "137",
      POLYMARKET_BUILDER_CODE: "lotus-builder"
    });

    expect(status).toMatchObject({
      submitMode: "relay",
      relayConfigured: true,
      readinessState: "LIVE_READY",
      requiredEnvPresent: true,
      missingEnv: []
    });
  });

  it("signs relay requests and rejects stale or tampered signatures", () => {
    const body = { order: { venue: "POLYMARKET", clientOrderId: "order-1", payload: { price: 0.5 } } };
    const timestamp = "2026-05-07T00:00:00.000Z";
    const nonce = createPolymarketRelayNonce();
    const signature = signPolymarketRelayRequest("relay-secret", {
      timestamp,
      nonce,
      method: "POST",
      path: "/internal/polymarket/v2/submit-order",
      body
    });

    expect(verifyPolymarketRelayRequest("relay-secret", {
      timestamp,
      nonce,
      signature,
      method: "POST",
      path: "/internal/polymarket/v2/submit-order",
      body,
      now: new Date("2026-05-07T00:00:10.000Z")
    })).toBe(true);
    expect(verifyPolymarketRelayRequest("relay-secret", {
      timestamp,
      nonce,
      signature,
      method: "POST",
      path: "/internal/polymarket/v2/submit-order",
      body: { ...body, extra: true },
      now: new Date("2026-05-07T00:00:10.000Z")
    })).toBe(false);
    expect(verifyPolymarketRelayRequest("relay-secret", {
      timestamp,
      nonce,
      signature,
      method: "POST",
      path: "/internal/polymarket/v2/submit-order",
      body,
      now: new Date("2026-05-07T00:01:00.000Z")
    })).toBe(false);
  });

  it("relay client signs and submits prepared Polymarket orders without local CLOB credentials", async () => {
    const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const client = new RelayPolymarketClobV2LiveClient({
      relayUrl: "https://relay.example",
      relaySecret: "relay-secret",
      fetchImpl: (async (url, init) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body))
        });
        return new Response(JSON.stringify({
          venueOrderId: "pm-order-1",
          status: "SUBMITTED",
          filledSize: "0",
          averagePrice: 0
        }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch
    });

    const result = await client.submitOrder({
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

    expect(result.venueOrderId).toBe("pm-order-1");
    expect(requests[0]?.url).toBe("https://relay.example/internal/polymarket/v2/submit-order");
    expect(requests[0]?.headers.get("x-lotus-relay-signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("server-side-secret");
  });

  it("relay client maps raw CLOB balance failures to a safe readiness blocker", async () => {
    const client = new RelayPolymarketClobV2LiveClient({
      relayUrl: "https://relay.example",
      relaySecret: "relay-secret",
      fetchImpl: (async () => new Response(JSON.stringify({
        message: "not enough balance / allowance: the balance is not enough -> balance: 0, order amount: 1274970"
      }), { status: 502, headers: { "content-type": "application/json" } })) as typeof fetch
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        venueMarketId: "pm-market-1",
        venueOutcomeId: "pm-outcome-yes",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
      message: "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry."
    });
  });

  it("relay client maps collateral rejection with confirmed attestation to sync propagation blocker", async () => {
    const client = new RelayPolymarketClobV2LiveClient({
      relayUrl: "https://relay.example",
      relaySecret: "relay-secret",
      fetchImpl: (async () => new Response(JSON.stringify({
        code: "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
        message: "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry."
      }), { status: 502, headers: { "content-type": "application/json" } })) as typeof fetch
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        venueMarketId: "pm-market-1",
        venueOutcomeId: "pm-outcome-yes",
        side: "buy",
        size: "1.25",
        price: 0.99,
        polymarketCollateralReadinessAttestation: {
          kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
          quoteId: "exec_quote_attested",
          legIndex: 0,
          checkedAt: new Date().toISOString(),
          requiredAtomic: "1999950",
          requiredNotional: "2.0000234320910905737",
          usableBalance: "7.85565",
          usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
          walletAddress: "0x623Bc9cDf0937c50aa0CAa0D8806412359963A20",
          ownerAddress: "0x5A77712f558ED6bBBe162b9202E668485060EBA4",
          venueAccountAddress: "0x5A77712f558ED6bBBe162b9202E668485060EBA4"
        }
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE",
      message: "Polymarket rejected this order even though live CLOB collateral readiness was confirmed. Lotus will recheck readiness automatically; retry after Polymarket propagation completes."
    });
  });

  it("relay routes reject missing authentication before reaching the CLOB client", async () => {
    const previousSecret = process.env.POLYMARKET_EXECUTION_RELAY_SECRET;
    process.env.POLYMARKET_EXECUTION_RELAY_SECRET = "relay-secret";
    const app = buildPolymarketExecutionRelayServer();
    const response = await app.inject({
      method: "POST",
      url: "/internal/polymarket/v2/submit-order",
      payload: { order: { venue: "POLYMARKET", clientOrderId: "order-1", payload: {} } }
    });
    await app.close();
    if (previousSecret === undefined) {
      delete process.env.POLYMARKET_EXECUTION_RELAY_SECRET;
    } else {
      process.env.POLYMARKET_EXECUTION_RELAY_SECRET = previousSecret;
    }

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "POLYMARKET_RELAY_AUTH_MISSING" });
  });

  it("prepares a safe Lotus-internal dry-run envelope with builderCode while live execution is disabled", async () => {
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

  it("dry-run client validates Lotus-internal signing and payload shape without exposing credentials", () => {
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
    expect(envelope.envelopeKind).toBe("LOTUS_INTERNAL_DRY_RUN_SHAPE");
    expect(envelope.lotusInternalRequest.body).toMatchObject({
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

  it("SDK live client blocks unsigned user-funded submit and maps fill, cancel, and settlement through CLOB V2", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("unsigned createAndPostOrder must not be used");
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
    })).rejects.toMatchObject({ reasonCode: "POLYMARKET_USER_SIGNATURE_REQUIRED" });
    expect(calls).toEqual([]);

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

  it("falls back to CLOB trade evidence when a matched order is no longer returned by getOrder", async () => {
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async getOrder() {
        return null;
      },
      async getTrades(params) {
        expect(params).toEqual({ id: "pm-order-filled" });
        return [{
          id: "trade-1",
          taker_order_id: "pm-order-filled",
          market: "pm-market-1",
          asset_id: "pm-outcome-yes",
          side: Side.BUY,
          size: "2",
          fee_rate_bps: "0",
          price: "0.25",
          status: "confirmed",
          match_time: "2026-05-13T00:00:00.000Z",
          last_update: "2026-05-13T00:00:00.000Z",
          outcome: "Yes",
          bucket_index: 0,
          owner: "owner",
          maker_address: "maker",
          maker_orders: [],
          transaction_hash: "0xsettlement",
          trader_side: "TAKER"
        }];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.fetchFillState("pm-order-filled")).resolves.toMatchObject({
      status: "FILLED",
      filledSize: "2",
      averagePrice: 0.25,
      offchainFilled: true
    });
  });

  it("wraps user-signed POLY_1271 deposit-wallet signatures before CLOB submit", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        return { orderID: "pm-order-1271", status: "MATCHED", takingAmount: "1", price: "0.51" };
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "2000000", allowance: "2000000" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1000000",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1",
        price: 0.51
      }
    })).resolves.toMatchObject({ venueOrderId: "pm-order-1271", status: "FILLED" });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "postOrder"
    ]);
    const [postedOrder, orderType] = calls[2]!.args as [Record<string, unknown>, OrderType];
    expect(orderType).toBe(OrderType.FOK);
    expect(postedOrder.signature).toBe(`0x${"aa".repeat(65)}${"bb".repeat(96)}`);
    expect(postedOrder.signature).not.toBe(`0x${"aa".repeat(65)}`);
  });

  it("accepts scientific-notation CLOB balance responses without crashing readiness", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        return { orderID: "pm-order-scientific-balance", status: "MATCHED", takingAmount: "1", price: "0.51" };
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "2094768658249378e-8", allowance: "2094768658249378e-8" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).resolves.toMatchObject({ venueOrderId: "pm-order-scientific-balance", status: "FILLED" });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "postOrder"
    ]);
  });

  it("blocks user-signed Polymarket orders before submit when CLOB collateral is not spendable", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        throw new Error("must not submit");
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "0", allowance: "2000000" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1000000",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1",
        price: 0.51
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
    });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance"
    ]);
    expect(calls[0]!.args[0]).toMatchObject({
      asset_type: AssetType.COLLATERAL,
      signature_type: SignatureTypeV2.POLY_1271
    });
    expect(calls[1]!.args[0]).toMatchObject({
      asset_type: AssetType.COLLATERAL,
      signature_type: SignatureTypeV2.POLY_1271
    });
  });

  it("blocks user-signed Polymarket buy submit until CLOB confirms spendable collateral", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        return { orderID: "pm-order-onchain-fallback", status: "MATCHED", takingAmount: "1", price: "0.51" };
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "0", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient, {
      async readUsableBalance({ userId }) {
        expect(userId).toBe("user-1");
        return {
          usableBalance: "2",
          collateralBalance: "2",
          collateralAllowance: "2",
          usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
        };
      }
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        expectedBinding: { userId: "user-1" },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({ reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY" });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance"
    ]);
  });

  it("does not post a Polymarket buy when confirmed user CLOB sync conflicts with the submit client balance", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        throw new Error("must not submit");
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "0", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient, {
      async readUsableBalance({ userId }) {
        expect(userId).toBe("user-1");
        return {
          usableBalance: "7.85565",
          collateralBalance: "0",
          collateralAllowance: "0",
          usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
        };
      }
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        expectedBinding: { userId: "user-1" },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SYNC_PENDING_FOR_SUBMIT"
    });
    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance"
    ]);
  });

  it("allows user-signed Polymarket buy submit when CLOB balance allowance covers required collateral", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        return { orderID: "pm-order-clob-allowance-confirmed", status: "MATCHED", takingAmount: "1.25", price: "0.99" };
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "2000000", allowance: "2000000" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient, {
      async readUsableBalance({ userId }) {
        expect(userId).toBe("user-1");
        return {
          usableBalance: "7.85565",
          collateralBalance: "7.85565",
          collateralAllowance: "9999999",
          usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
        };
      }
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        expectedBinding: { userId: "user-1" },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).resolves.toMatchObject({
      venueOrderId: "pm-order-clob-allowance-confirmed",
      status: "FILLED"
    });
    expect(calls.at(-1)?.args[1]).toBe(OrderType.FOK);
  });

  it("blocks relay-side submit when only API-attested on-chain CLOB spender readiness is present", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        return { orderID: "pm-order-attested-readiness", status: "MATCHED", takingAmount: "1", price: "0.51" };
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "0", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        polymarketCollateralReadinessAttestation: {
          kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
          requiredAtomic: "1274970",
          usableBalanceSource: "ONCHAIN_CLOB_SPENDER_ALLOWANCE",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
        },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({ reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY" });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance"
    ]);
  });

  it("allows signed-bundle submit through fresh user CLOB sync attestation when SDK balance lags", async () => {
    const calls: string[] = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder() {
        calls.push("postOrder");
        return { orderID: "pm-order-direct-clob-attested", status: "MATCHED", takingAmount: "1", price: "0.51" };
      },
      async updateBalanceAllowance() {
        calls.push("updateBalanceAllowance");
        return {};
      },
      async getBalanceAllowance() {
        calls.push("getBalanceAllowance");
        return { balance: "0", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        polymarketCollateralReadinessAttestation: {
          kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
          quoteId: "exec_quote_attested",
          legIndex: 0,
          checkedAt: new Date().toISOString(),
          requiredAtomic: "1274970",
          requiredNotional: "1.27497",
          usableBalance: "7.85565",
          usableBalanceSource: "USER_CLOB_SYNC_CONFIRMED",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP",
          walletAddress: "0x1111111111111111111111111111111111111111",
          ownerAddress: "0x1111111111111111111111111111111111111111",
          venueAccountAddress: "0x2222222222222222222222222222222222222222"
        },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).resolves.toMatchObject({
      venueOrderId: "pm-order-direct-clob-attested",
      status: "FILLED"
    });

    expect(calls).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "postOrder"
    ]);
  });

  it("maps venue collateral rejection after confirmed readiness to CLOB sync propagation rejection", async () => {
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder() {
        throw new Error("not enough balance / allowance");
      },
      async updateBalanceAllowance() {
        return {};
      },
      async getBalanceAllowance() {
        return { balance: "2000000", allowance: "2000000" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        polymarketCollateralReadinessAttestation: {
          kind: "POLYMARKET_CLOB_COLLATERAL_PREFLIGHT",
          quoteId: "exec_quote_attested",
          legIndex: 0,
          checkedAt: new Date().toISOString(),
          requiredAtomic: "1274970",
          requiredNotional: "1.27497",
          usableBalance: "7.85565",
          usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE",
          approvalSpenderSource: "CLOB_ALLOWANCE_MAP"
        },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE"
    });
  });

  it("writes a redacted diagnostic artifact for raw Polymarket postOrder rejection", async () => {
    const rawError = Object.assign(new Error(
      `invalid signature for token ${diagnosticLongTokenId}; Authorization: Bearer super-secret-token`
    ), {
      status: 400,
      code: "INVALID_SIGNATURE",
      response: {
        status: 400,
        data: {
          status: "FAILED",
          code: "INVALID_SIGNATURE",
          message: `invalid signature for token ${diagnosticLongTokenId}`,
          tokenId: diagnosticLongTokenId,
          apiKey: completeEnv.POLY_API_KEY,
          secret: completeEnv.POLY_API_SECRET,
          passphrase: completeEnv.POLY_API_PASSPHRASE,
          signature: `0x${"aa".repeat(65)}`,
          headers: {
            authorization: "Bearer should-not-leak"
          }
        }
      }
    });
    const client = diagnosticClient(diagnosticSdkClient(rawError));

    await expect(client.submitOrder(signedPolymarketVenueOrder())).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SIGNATURE_REJECTED"
    });

    expect(existsSync(polymarketPostOrderDiagnosticPath)).toBe(true);
    const artifactText = readFileSync(polymarketPostOrderDiagnosticPath, "utf8");
    const artifact = JSON.parse(artifactText) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      quoteId: "exec_quote_diagnostic",
      httpStatus: 400,
      polymarketApiStatus: "FAILED",
      rawVenueErrorCode: "INVALID_SIGNATURE",
      normalizedReasonCode: "POLYMARKET_CLOB_SIGNATURE_REJECTED",
      signedOrderSummary: {
        signatureType: "POLY_1271",
        makerEqualsDepositWallet: true,
        signerEqualsDepositWallet: true,
        funderEqualsDepositWallet: true,
        makerSignerFunderAllEqualDepositWallet: true,
        orderType: "FOK",
        makerAmountAtomic: "1274970",
        takerAmountAtomic: "100000000",
        tickSize: "0.01",
        negRisk: false,
        builderConfigured: true
      },
      readinessSummary: {
        readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
        usableBalanceSource: "SDK_BALANCE_ALLOWANCE",
        liveSubmitSpendableBalance: "2",
        requiredAtomic: "1274970"
      },
      clientConstructorSummary: {
        constructorSignatureType: "POLY_1271",
        constructorFunderEqualsDepositWallet: true
      }
    });
    expect(artifactText).not.toContain(completeEnv.POLY_API_KEY);
    expect(artifactText).not.toContain(completeEnv.POLY_API_SECRET);
    expect(artifactText).not.toContain(completeEnv.POLY_API_PASSPHRASE);
    expect(artifactText).not.toContain("super-secret-token");
    expect(artifactText).not.toContain("should-not-leak");
    expect(artifactText).not.toContain(`0x${"aa".repeat(65)}`);
    expect(artifactText).not.toContain(`0x${"bb".repeat(96)}`);
    expect(artifactText).not.toContain(diagnosticLongTokenId);
    expect(artifactText).toContain("<token-id-redacted");
  });

  it("writes a redacted diagnostic artifact when Polymarket returns a FAILED postOrder body", async () => {
    const client = diagnosticClient(diagnosticSdkClientReturning({
      status: "FAILED",
      code: "INVALID_ORDER",
      message: `invalid order: maker amount violates tick size for token ${diagnosticLongTokenId}`,
      tokenId: diagnosticLongTokenId,
      signature: `0x${"cc".repeat(65)}`,
      apiKey: completeEnv.POLY_API_KEY
    }));

    await expect(client.submitOrder(signedPolymarketVenueOrder())).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"
    });

    expect(existsSync(polymarketPostOrderDiagnosticPath)).toBe(true);
    const artifactText = readFileSync(polymarketPostOrderDiagnosticPath, "utf8");
    const artifact = JSON.parse(artifactText) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      polymarketApiStatus: "FAILED",
      rawVenueErrorCode: "INVALID_ORDER",
      normalizedReasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"
    });
    expect(artifactText).not.toContain(completeEnv.POLY_API_KEY);
    expect(artifactText).not.toContain(`0x${"cc".repeat(65)}`);
    expect(artifactText).not.toContain(diagnosticLongTokenId);
    expect(artifactText).toContain("<token-id-redacted");
  });

  it.each([
    ["signature has invalid EIP712 1271 signature", "POLYMARKET_CLOB_SIGNATURE_REJECTED"],
    ["Unauthorized: API key HMAC credential rejected", "POLYMARKET_CLOB_AUTH_REJECTED"],
    ["invalid order: maker amount violates tick size for FOK", "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED"],
    ["market closed for token id / invalid outcome", "POLYMARKET_CLOB_MARKET_REJECTED"],
    ["unexpected venue rejection without known category", "POLYMARKET_CLOB_UNKNOWN_REJECTED_BY_VENUE"]
  ])("maps raw Polymarket postOrder rejection '%s' to %s", async (message, reasonCode) => {
    const client = diagnosticClient(diagnosticSdkClient(new Error(message)));

    await expect(client.submitOrder(signedPolymarketVenueOrder())).rejects.toMatchObject({
      reasonCode
    });
  });

  it("maps collateral postOrder rejection to sync only after confirmed submit readiness", async () => {
    const client = diagnosticClient(diagnosticSdkClient(new Error("not enough balance / allowance")));

    await expect(client.submitOrder(signedPolymarketVenueOrder({
      polymarketCollateralReadinessAttestation: undefined
    }))).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE"
    });

    rmSync(polymarketPostOrderDiagnosticPath, { force: true });
    const sdkWithoutReadyBalance = diagnosticSdkClient(new Error("not enough balance / allowance"));
    sdkWithoutReadyBalance.getBalanceAllowance = async () => ({ balance: "0", allowance: "0" });
    const blockedClient = diagnosticClient(sdkWithoutReadyBalance);
    await expect(blockedClient.submitOrder(signedPolymarketVenueOrder({
      polymarketCollateralReadinessAttestation: undefined
    }))).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
    });
    expect(existsSync(polymarketPostOrderDiagnosticPath)).toBe(false);
  });

  it("does not allow Polymarket buy submit through non-CLOB on-chain allowance fallback", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        throw new Error("must not submit");
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "0", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient, {
      async readUsableBalance() {
        return {
          usableBalance: "2",
          collateralBalance: "2",
          collateralAllowance: "2",
          usableBalanceSource: "ONCHAIN_PUSD_ALLOWANCE",
          approvalSpenderSource: "CONFIG_FALLBACK"
        };
      }
    });

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        expectedBinding: { userId: "user-1" },
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_COLLATERAL_NOT_READY"
    });

    expect(calls.map((call) => call.method)).not.toContain("postOrder");
  });

  it("blocks user-signed Polymarket sell orders before submit when outcome-token allowance is missing", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("not used");
      },
      async postOrder(order, orderType) {
        calls.push({ method: "postOrder", args: [order, orderType] });
        throw new Error("must not submit");
      },
      async updateBalanceAllowance(params) {
        calls.push({ method: "updateBalanceAllowance", args: [params] });
        return {};
      },
      async getBalanceAllowance(params) {
        calls.push({ method: "getBalanceAllowance", args: [params] });
        return { balance: "80000000", allowance: "0" };
      },
      async getOrder() {
        throw new Error("not used");
      },
      async getTrades() {
        return [];
      },
      async cancelOrder() {
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
      privateKey: completeEnv.POLY_PRIVATE_KEY
    }, () => sdkClient);

    await expect(client.submitOrder({
      venue: "POLYMARKET",
      clientOrderId: "execution-1-leg-1",
      payload: {
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "80000000",
              takerAmount: "1200000",
              side: "SELL",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "sell",
        size: "80",
        price: 0.015
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_CONDITIONAL_TOKEN_NOT_READY"
    });

    expect(calls.map((call) => call.method)).toEqual([
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance",
      "updateBalanceAllowance",
      "getBalanceAllowance"
    ]);
    expect(calls[0]!.args[0]).toMatchObject({ asset_type: AssetType.CONDITIONAL, token_id: "123" });
    expect(calls[1]!.args[0]).toMatchObject({ asset_type: AssetType.CONDITIONAL, token_id: "123" });
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
          throw new Error("unsigned createAndPostOrder must not be used");
        },
        async postOrder() {
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
        async updateBalanceAllowance() {
          return {};
        },
        async getBalanceAllowance() {
          return { balance: "2000000", allowance: "2000000" };
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
          signedPayload: {
            signature: `0x${"aa".repeat(65)}`,
            data: {
              polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
              order: {
                salt: "1",
                maker: "0x1111111111111111111111111111111111111111",
                signer: "0x1111111111111111111111111111111111111111",
                tokenId: "123",
                makerAmount: "1000000",
                takerAmount: "100000000",
                side: "BUY",
                signatureType: 3,
                timestamp: "1",
                expiration: "0",
                metadata: `0x${"00".repeat(32)}`,
                builder: `0x${"11".repeat(32)}`
              }
            }
          },
          venueMarketId: "pm-market-1",
          venueOutcomeId: "123",
          side: "buy",
          size: "1",
          price: 0.51
        }
      })).rejects.toMatchObject({ reasonCode: "POLYMARKET_CLOB_AUTH_REJECTED" });
    } finally {
      console.error = originalError;
    }
    const output = JSON.stringify(captured);
    expect(output).not.toContain(completeEnv.POLY_API_KEY);
    expect(output).not.toContain(completeEnv.POLY_API_PASSPHRASE);
    expect(output).not.toContain(completeEnv.POLY_API_SECRET);
    expect(output).not.toContain("generated-header-signature");
    expect(output).not.toContain("0xgeneratedordersignature");
    expect(output).not.toContain(completeEnv.POLY_BUILDER_CODE);
    expect(output).toContain("<redacted>");
  });

  it("maps raw CLOB balance failures after SDK-confirmed readiness to a sync propagation blocker", async () => {
    const sdkClient: PolymarketClobV2SdkClient = {
      async createAndPostOrder() {
        throw new Error("unsigned createAndPostOrder must not be used");
      },
      async postOrder() {
        throw new Error("not enough balance / allowance: the balance is not enough -> balance: 0, order amount: 1274970");
      },
      async updateBalanceAllowance() {
        return {};
      },
      async getBalanceAllowance() {
        return { balance: "2000000", allowance: "2000000" };
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
        signedPayload: {
          signature: `0x${"aa".repeat(65)}`,
          data: {
            polymarketSignatureSuffix: `0x${"bb".repeat(96)}`,
            order: {
              salt: "1",
              maker: "0x1111111111111111111111111111111111111111",
              signer: "0x1111111111111111111111111111111111111111",
              tokenId: "123",
              makerAmount: "1274970",
              takerAmount: "100000000",
              side: "BUY",
              signatureType: 3,
              timestamp: "1",
              expiration: "0",
              metadata: `0x${"00".repeat(32)}`,
              builder: `0x${"11".repeat(32)}`
            }
          }
        },
        venueMarketId: "pm-market-1",
        venueOutcomeId: "123",
        side: "buy",
        size: "1.25",
        price: 0.99
      }
    })).rejects.toMatchObject({
      reasonCode: "POLYMARKET_CLOB_SYNC_REJECTED_BY_VENUE",
      message: "Polymarket rejected this order with a collateral or sync response even though live CLOB collateral readiness was confirmed. Lotus preserved the raw redacted venue evidence for debugging."
    });
  });

  it("maps settlement states for verified, pending, timeout, suspected, and confirmed outcomes", () => {
    expect(mapPolymarketV2SettlementState({ settlementStatus: "settled" }).status).toBe("SETTLEMENT_VERIFIED");
    expect(mapPolymarketV2SettlementState({ settlementStatus: "pending" }).status).toBe("SETTLEMENT_PENDING");
    expect(mapPolymarketV2SettlementState({ settlementStatus: "timeout" }).status).toBe("SETTLEMENT_TIMEOUT");
    expect(mapPolymarketV2SettlementState({ ghostFillSuspected: true }).status).toBe("GHOST_FILL_SUSPECTED");
    expect(mapPolymarketV2SettlementState({ ghostFillConfirmed: true }).status).toBe("GHOST_FILL_CONFIRMED");
  });

  it("preserves builder fee evidence on verified settlement without exposing auth secrets", () => {
    const settlement = mapPolymarketV2SettlementState({
      settlementStatus: "settled",
      builderFeeAmount: "0.25",
      builderFeeBps: "5"
    });
    expect(settlement).toMatchObject({
      status: "SETTLEMENT_VERIFIED",
      evidence: {
        builderFeeAmount: "0.25",
        builderFeeBps: "5"
      }
    });
    expect(JSON.stringify(settlement)).not.toContain("POLYMARKET_API_SECRET");
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
