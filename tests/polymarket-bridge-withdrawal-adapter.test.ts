import { describe, expect, it } from "vitest";

import {
  getPolymarketBridgeWithdrawalConfigFromEnv,
  HttpPolymarketBridgeWithdrawalClient,
  MockPolymarketBridgeWithdrawalClient,
  normalizeSupportedAssets,
  PolymarketBridgeWithdrawalAdapter,
  resolvePolymarketBridgeDestinationAsset
} from "../src/core/funding/polymarket-bridge-withdrawal-adapter.js";

const enabledConfig = {
  enabled: true,
  mode: "DRY_RUN" as const,
  apiBaseUrl: "https://bridge.example",
  authMode: "NONE" as const,
  timeoutMs: 5_000,
  dryRunOnly: true,
  configured: true
};

describe("Polymarket Bridge withdrawal adapter dry-run", () => {
  it("keeps bridge withdrawal config disabled by default", () => {
    expect(getPolymarketBridgeWithdrawalConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: "DISABLED",
      apiBaseUrl: null,
      authMode: "NONE",
      timeoutMs: 5_000,
      dryRunOnly: true,
      configured: false
    });
  });

  it("normalizes supported assets and rejects malformed supported asset payloads", () => {
    expect(normalizeSupportedAssets({
      assets: [{ chain: "POLYGON", token: "USDC", tokenAddress: "0x123", enabled: true }]
    })).toEqual([{
      chain: "POLYGON",
      chainId: null,
      token: "USDC",
      tokenAddress: "0x123",
      decimals: null,
      minCheckoutUsd: null,
      enabled: true
    }]);
    expect(normalizeSupportedAssets({
      supportedAssets: [{
        chainId: "137",
        chainName: "Polygon",
        token: {
          symbol: "USDC",
          address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
          decimals: 6
        },
        minCheckoutUsd: 2
      }]
    })).toEqual([{
      chain: "Polygon",
      chainId: "137",
      token: "USDC",
      tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      decimals: 6,
      minCheckoutUsd: 2,
      enabled: true
    }]);

    expect(() => normalizeSupportedAssets({ assets: [{ chain: "POLYGON" }] })).toThrow("POLYMARKET_BRIDGE_SUPPORTED_ASSET_MALFORMED");
    expect(() => normalizeSupportedAssets({ ok: true })).toThrow("POLYMARKET_BRIDGE_SUPPORTED_ASSETS_MALFORMED");
  });

  it("prepares a safe quote and user action without provider internals", async () => {
    const adapter = new PolymarketBridgeWithdrawalAdapter(new MockPolymarketBridgeWithdrawalClient(), enabledConfig, {
      now: () => new Date("2026-04-26T00:00:00.000Z")
    });

    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    });
    const userAction = await adapter.prepareUserAction(quote);
    const serialized = JSON.stringify({ quote, userAction });

    expect(quote).toMatchObject({
      provider: "POLYMARKET_BRIDGE",
      sourceVenue: "POLYMARKET",
      fromChainId: "137",
      fromAmountBaseUnit: "40000000",
      toChainId: "137",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      amount: "40"
    });
    expect(userAction).toMatchObject({
      actionType: "USER_SEND_FROM_POLYMARKET_WALLET",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      amount: "40"
    });
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("privateKey");
  });

  it("maps Base USDC withdrawals into the provider quote request", async () => {
    const bodies: unknown[] = [];
    const client = new HttpPolymarketBridgeWithdrawalClient({
      apiBaseUrl: "https://bridge.example",
      timeoutMs: 5_000,
      authMode: "NONE",
      fetchImpl: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({
          quoteId: "base-quote",
          amount: "12",
          estimatedFees: "0",
          expiresAt: "2026-04-26T00:01:00.000Z"
        }), { status: 200 });
      }) as typeof fetch
    });

    const raw = await client.fetchQuote({
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "12"
    });
    const quote = await new PolymarketBridgeWithdrawalAdapter({
      fetchSupportedAssets: async () => ({ assets: [] }),
      fetchQuote: async () => raw,
      createWithdrawalAddress: async () => ({ bridgeAddress: "0x2222222222222222222222222222222222222222" }),
      fetchStatus: async () => ({ status: "PENDING" })
    }, enabledConfig, { now: () => new Date("2026-04-26T00:00:00.000Z") }).prepareWithdrawalQuote({
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "12"
    });

    expect(bodies[0]).toMatchObject({
      fromChainId: "137",
      toChainId: "8453",
      toTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      fromAmountBaseUnit: "12000000"
    });
    expect(quote).toMatchObject({
      toChainId: "8453",
      toTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      destinationChain: "BASE",
      destinationToken: "USDC"
    });
    expect(resolvePolymarketBridgeDestinationAsset("8453", "USDC")).toMatchObject({
      chain: "BASE",
      chainId: "8453"
    });
  });

  it("normalizes completion evidence and validates exact destination scope", async () => {
    const adapter = new PolymarketBridgeWithdrawalAdapter(new MockPolymarketBridgeWithdrawalClient(), enabledConfig);
    const rawStatus = await adapter.fetchWithdrawalStatus({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    const evidence = adapter.normalizeWithdrawalEvidence({
      ...rawStatus,
      completed: true
    });

    expect(evidence).toMatchObject({
      completed: true,
      venue: "POLYMARKET",
      sourceVenue: "POLYMARKET",
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      amount: "40",
      confidence: "EXACT"
    });
    expect(evidence.rawEvidenceRedacted).toMatchObject({
      txHashPresent: true,
      bridgeAddressPresent: true,
      destinationAddressPresent: true
    });
    expect(JSON.stringify(evidence)).not.toContain("rawProviderPayload");

    expect(adapter.validateCompletionEvidence({
      evidence,
      expectedScope: {
        sourceVenue: "POLYMARKET",
        destinationAddress: "0x1111111111111111111111111111111111111111",
        destinationChain: "POLYGON",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    })).toEqual({ valid: true, rejectionReason: null });
  });

  it("fails completion closed when completed=true is missing or scope mismatches", async () => {
    const adapter = new PolymarketBridgeWithdrawalAdapter(new MockPolymarketBridgeWithdrawalClient(), enabledConfig);
    const rawStatus = await adapter.fetchWithdrawalStatus({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    const missingCompletedFlag = adapter.normalizeWithdrawalEvidence({
      ...rawStatus,
      completed: false
    });

    expect(missingCompletedFlag.completed).toBe(false);
    expect(adapter.validateCompletionEvidence({
      evidence: missingCompletedFlag,
      expectedScope: {
        sourceVenue: "POLYMARKET",
        destinationAddress: "0x1111111111111111111111111111111111111111",
        destinationChain: "POLYGON",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    })).toEqual({
      valid: false,
      rejectionReason: "POLYMARKET_BRIDGE_WITHDRAWAL_NOT_COMPLETED"
    });

    const completed = adapter.normalizeWithdrawalEvidence({ ...rawStatus, completed: true });
    expect(adapter.validateCompletionEvidence({
      evidence: completed,
      expectedScope: {
        sourceVenue: "POLYMARKET",
        destinationAddress: "0x9999999999999999999999999999999999999999",
        destinationChain: "POLYGON",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    })).toEqual({
      valid: false,
      rejectionReason: "POLYMARKET_BRIDGE_DESTINATION_ADDRESS_MISMATCH"
    });
  });

  it("refuses adapter actions when disabled or dry-run-only is unset", async () => {
    const disabled = new PolymarketBridgeWithdrawalAdapter(new MockPolymarketBridgeWithdrawalClient(), {
      ...enabledConfig,
      enabled: false,
      configured: false
    });
    await expect(disabled.getSupportedBridgeAssets()).rejects.toThrow("POLYMARKET_BRIDGE_WITHDRAWALS_DISABLED");

    const unsafe = new PolymarketBridgeWithdrawalAdapter(new MockPolymarketBridgeWithdrawalClient(), {
      ...enabledConfig,
      dryRunOnly: false
    });
    await expect(unsafe.getSupportedBridgeAssets()).rejects.toThrow("POLYMARKET_BRIDGE_DRY_RUN_ONLY_REQUIRED");
  });
});
