import { describe, expect, it } from "vitest";

import {
  getLimitlessWithdrawalConfigFromEnv,
  HttpLimitlessWithdrawalClient,
  LimitlessWithdrawalAdapter,
  MockLimitlessWithdrawalClient,
  normalizeStatus
} from "../src/core/funding/limitless-withdrawal-adapter.js";

const enabledConfig = {
  enabled: true,
  mode: "DRY_RUN_READ_STATUS" as const,
  apiBaseUrl: "https://api.limitless.example",
  authMode: "HMAC" as const,
  timeoutMs: 5_000,
  dryRunOnly: true,
  configured: true
};

describe("Limitless withdrawal adapter dry-run/read-status", () => {
  it("keeps Limitless withdrawal adapter config disabled by default", () => {
    expect(getLimitlessWithdrawalConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: "DISABLED",
      apiBaseUrl: null,
      authMode: "NONE",
      timeoutMs: 5_000,
      dryRunOnly: true,
      configured: false
    });
  });

  it("parses enabled dry-run config without enabling live execution", () => {
    expect(getLimitlessWithdrawalConfigFromEnv({
      LIMITLESS_WITHDRAWAL_ADAPTER_ENABLED: "true",
      LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL: "https://api.limitless.exchange",
      LIMITLESS_WITHDRAWAL_ADAPTER_AUTH_MODE: "HMAC",
      LIMITLESS_WITHDRAWAL_ADAPTER_TIMEOUT_MS: "9000",
      LIMITLESS_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true"
    } as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      mode: "DRY_RUN_READ_STATUS",
      apiBaseUrl: "https://api.limitless.exchange",
      authMode: "HMAC",
      timeoutMs: 9_000,
      dryRunOnly: true,
      configured: true
    });
  });

  it("classifies Limitless as auto-resolution-only with disabled partner-managed backend withdrawal", () => {
    const adapter = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), enabledConfig);

    expect(adapter.getWithdrawalCapabilities()).toMatchObject({
      venue: "LIMITLESS",
      supportsWithdrawal: false,
      withdrawalMode: "AUTO_RESOLUTION_ONLY",
      userSignedWithdrawalSupported: false,
      partnerManagedWithdrawal: {
        mode: "PARTNER_MANAGED_BACKEND",
        enabled: false,
        requiresHmacAuth: true,
        requiresWithdrawalScope: true,
        requiresCustodySecurityApproval: true
      },
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: false,
      requiresUserSignature: false
    });
  });

  it("prepares review-only quote and user action without provider internals", async () => {
    const adapter = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), enabledConfig, {
      now: () => new Date("2026-04-26T00:00:00.000Z")
    });

    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAddress: "0x2222222222222222222222222222222222222222",
      amount: "40"
    });
    const action = adapter.prepareUserAction(quote);
    const serialized = JSON.stringify({ quote, action });

    expect(quote).toMatchObject({
      provider: "LIMITLESS_SERVER_WALLET",
      sourceVenue: "LIMITLESS",
      destinationChain: "BASE",
      destinationToken: "USDC",
      amount: "40",
      amountBaseUnit: "40000000"
    });
    expect(action).toMatchObject({
      actionType: "LIMITLESS_SERVER_WALLET_WITHDRAWAL_REVIEW_ONLY",
      destinationChain: "BASE",
      destinationToken: "USDC",
      amount: "40"
    });
    expect(serialized).not.toContain("/portfolio/withdraw");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("privateKey");
  });

  it("normalizes Limitless portfolio history status", () => {
    expect(normalizeStatus({
      data: [{
        type: "withdrawal",
        status: "success",
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        destination: "0x2222222222222222222222222222222222222222",
        token: { symbol: "USDC" },
        amount: "40",
        completedAt: "2026-04-26T00:00:00.000Z"
      }]
    })).toEqual({
      status: "COMPLETED",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAddress: "0x2222222222222222222222222222222222222222",
      amount: "40",
      completedAt: "2026-04-26T00:00:00.000Z"
    });
    expect(normalizeStatus({ data: [{ type: "withdrawal", status: "mystery" }] }).status).toBe("UNKNOWN");
  });

  it("normalizes completion evidence and validates exact scope", async () => {
    const adapter = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), enabledConfig);
    const rawStatus = await adapter.fetchWithdrawalStatus({
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    });
    const evidence = adapter.normalizeWithdrawalEvidence({
      ...rawStatus,
      completed: true
    });

    expect(evidence).toMatchObject({
      completed: true,
      venue: "LIMITLESS",
      sourceVenue: "LIMITLESS",
      destinationChain: "BASE",
      destinationToken: "USDC",
      amount: "40",
      confidence: "EXACT"
    });
    expect(evidence.rawEvidenceRedacted).toMatchObject({
      txHashPresent: true,
      destinationAddressPresent: true
    });
    expect(JSON.stringify(evidence)).not.toContain("rawProviderPayload");

    expect(adapter.validateCompletionEvidence({
      evidence,
      expectedScope: {
        sourceVenue: "LIMITLESS",
        destinationAddress: "0x2222222222222222222222222222222222222222",
        destinationChain: "BASE",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    })).toEqual({ valid: true, rejectionReason: null });
  });

  it("fails completion closed when completion flag is missing or scope mismatches", async () => {
    const adapter = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), enabledConfig);
    const rawStatus = await adapter.fetchWithdrawalStatus({
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    });
    const missingCompleted = adapter.normalizeWithdrawalEvidence({
      ...rawStatus,
      completed: false
    });

    expect(adapter.validateCompletionEvidence({
      evidence: missingCompleted,
      expectedScope: {
        sourceVenue: "LIMITLESS",
        destinationAddress: "0x2222222222222222222222222222222222222222",
        destinationChain: "BASE",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    })).toEqual({
      valid: false,
      rejectionReason: "LIMITLESS_WITHDRAWAL_NOT_COMPLETED"
    });

    const completed = adapter.normalizeWithdrawalEvidence({ ...rawStatus, completed: true });
    expect(adapter.validateCompletionEvidence({
      evidence: completed,
      expectedScope: {
        sourceVenue: "LIMITLESS",
        destinationAddress: "0x9999999999999999999999999999999999999999",
        destinationChain: "BASE",
        destinationToken: "USDC",
        amount: "40",
        txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    })).toEqual({
      valid: false,
      rejectionReason: "LIMITLESS_WITHDRAWAL_DESTINATION_ADDRESS_MISMATCH"
    });
  });

  it("refuses adapter actions when disabled or dry-run-only is unset", async () => {
    const disabled = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), {
      ...enabledConfig,
      enabled: false,
      configured: false
    });
    await expect(disabled.prepareWithdrawalQuote({
      destinationChain: "BASE",
      destinationToken: "USDC",
      destinationAddress: "0x2222222222222222222222222222222222222222",
      amount: "40"
    })).rejects.toThrow("LIMITLESS_WITHDRAWAL_ADAPTER_DISABLED");

    const unsafe = new LimitlessWithdrawalAdapter(new MockLimitlessWithdrawalClient(), {
      ...enabledConfig,
      dryRunOnly: false
    });
    await expect(unsafe.fetchWithdrawalStatus({})).rejects.toThrow("LIMITLESS_WITHDRAWAL_DRY_RUN_ONLY_REQUIRED");
  });

  it("uses official HMAC signing order and x-on-behalf-of for programmatic reads", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const client = new HttpLimitlessWithdrawalClient({
      apiBaseUrl: "https://api.limitless.exchange",
      timeoutMs: 5_000,
      authMode: "HMAC",
      apiKey: "programmatic-key",
      hmacSecret: "c2VjcmV0LWJ5dGVz",
      onBehalfOfProfileId: "profile-123",
      timestampFormat: "UNIX_MS",
      now: () => new Date("2026-04-26T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: Object.fromEntries(new Headers(init?.headers).entries())
        });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await client.fetchPortfolioHistory({ page: 1, limit: 25 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.limitless.exchange/portfolio/history?limit=25");
    expect(calls[0]?.headers).toMatchObject({
      "lmts-api-key": "programmatic-key",
      "lmts-timestamp": "1777161600000",
      "x-on-behalf-of": "profile-123"
    });
    expect(calls[0]?.headers["lmts-signature"]).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("supports configurable portfolio history path and query for dry-run diagnostics", async () => {
    const calls: Array<{ url: string }> = [];
    const client = new HttpLimitlessWithdrawalClient({
      apiBaseUrl: "https://api.limitless.exchange",
      timeoutMs: 5_000,
      authMode: "NONE",
      historyPath: "/programmatic/portfolio/history",
      historyQuery: "page=2&limit=10&type=withdrawal",
      fetchImpl: async (url) => {
        calls.push({ url: String(url) });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await client.fetchPortfolioHistory({ page: 1, limit: 25 });

    expect(calls[0]?.url).toBe("https://api.limitless.exchange/programmatic/portfolio/history?page=2&limit=10&type=withdrawal");
  });
});
