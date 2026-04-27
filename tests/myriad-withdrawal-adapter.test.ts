import { describe, expect, it } from "vitest";

import {
  getMyriadWithdrawalConfigFromEnv,
  MyriadWalletWithdrawalAdapter,
  verifyMyriadWithdrawalRedaction
} from "../src/core/funding/myriad-withdrawal-adapter.js";

const enabledConfig = {
  enabled: true,
  mode: "USER_WALLET_DRY_RUN" as const,
  instructionsUrl: "https://docs.myriad.markets/deposit-and-withdraw",
  timeoutMs: 5_000,
  dryRunOnly: true,
  configured: true
};

describe("Myriad withdrawal user-wallet dry-run adapter", () => {
  it("keeps Myriad withdrawal adapter config disabled by default", () => {
    expect(getMyriadWithdrawalConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: "DISABLED",
      instructionsUrl: "https://docs.myriad.markets/deposit-and-withdraw",
      timeoutMs: 5_000,
      dryRunOnly: true,
      configured: false
    });
  });

  it("parses enabled dry-run config without enabling live mutation", () => {
    expect(getMyriadWithdrawalConfigFromEnv({
      MYRIAD_WITHDRAWAL_ADAPTER_ENABLED: "true",
      MYRIAD_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      MYRIAD_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.myriad.markets/deposit-and-withdraw",
      MYRIAD_WITHDRAWAL_ADAPTER_TIMEOUT_MS: "7000"
    } as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      mode: "USER_WALLET_DRY_RUN",
      instructionsUrl: "https://docs.myriad.markets/deposit-and-withdraw",
      timeoutMs: 7_000,
      dryRunOnly: true,
      configured: true
    });
  });

  it("prepares safe Myriad BSC USD1 user-wallet instructions without backend signing data", async () => {
    const adapter = new MyriadWalletWithdrawalAdapter(enabledConfig, {
      now: () => new Date("2026-04-27T00:00:00.000Z")
    });

    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USD1",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    });
    const userAction = await adapter.prepareUserAction(quote);
    const serialized = JSON.stringify({ quote, userAction });

    expect(adapter.getWithdrawalCapabilities()).toMatchObject({
      venue: "MYRIAD",
      classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: true,
      readinessStatus: "DRY_RUN_READY"
    });
    expect(quote).toMatchObject({
      provider: "MYRIAD_USER_WALLET",
      sourceVenue: "MYRIAD",
      destinationChain: "BSC",
      destinationToken: "USD1",
      amount: "40",
      estimatedFees: "0",
      instructionsUrl: "https://docs.myriad.markets/deposit-and-withdraw"
    });
    expect(userAction).toMatchObject({
      actionType: "USER_COMPLETE_MYRIAD_WALLET_WITHDRAWAL",
      walletModel: "THIRDWEB",
      destinationChain: "BSC",
      destinationToken: "USD1",
      amount: "40"
    });
    expect(serialized).toContain("Lotus does not hold private keys");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("walletSeed");
    expect(serialized).not.toContain("thirdwebSigner");
    expect(serialized).not.toContain("thirdwebSecret");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("sessionToken");
    expect(serialized).not.toContain("rawProviderPayload");
  });

  it("refuses disabled, unsafe, or non-BSC-USD1 actions", async () => {
    await expect(new MyriadWalletWithdrawalAdapter({
      ...enabledConfig,
      enabled: false,
      mode: "DISABLED",
      configured: false
    }).prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USD1",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("MYRIAD_WITHDRAWAL_ADAPTER_DISABLED");

    await expect(new MyriadWalletWithdrawalAdapter({
      ...enabledConfig,
      dryRunOnly: false
    }).prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USD1",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("MYRIAD_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");

    await expect(new MyriadWalletWithdrawalAdapter(enabledConfig).prepareWithdrawalQuote({
      destinationChain: "ABSTRACT",
      destinationToken: "USDC.e",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("MYRIAD_WITHDRAWAL_BSC_USD1_REQUIRED");
  });

  it("redacts environment secrets and forbidden provider internals", () => {
    expect(verifyMyriadWithdrawalRedaction({
      provider: "MYRIAD_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "THIRDWEB"
    }, {
      MYRIAD_API_KEY: "myriad-secret",
      MYRIAD_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-secret",
      DATABASE_URL: "postgres://secret",
      TEST_DATABASE_URL: "postgres://test-secret"
    } as NodeJS.ProcessEnv)).toBe(true);

    expect(verifyMyriadWithdrawalRedaction({
      authHeader: "Bearer myriad-secret"
    }, {
      MYRIAD_API_KEY: "myriad-secret"
    } as NodeJS.ProcessEnv)).toBe(false);
  });
});
