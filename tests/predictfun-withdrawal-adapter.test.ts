import { describe, expect, it } from "vitest";

import {
  getPredictFunWithdrawalConfigFromEnv,
  PredictFunWithdrawalAdapter,
  verifyPredictFunWithdrawalRedaction
} from "../src/core/funding/predictfun-withdrawal-adapter.js";

const enabledConfig = {
  enabled: true,
  mode: "USER_WALLET_DRY_RUN" as const,
  instructionsUrl: "https://docs.predict.fun/knowledge-base/wallets",
  timeoutMs: 5_000,
  dryRunOnly: true,
  configured: true
};

describe("Predict.fun withdrawal user-wallet dry-run adapter", () => {
  it("keeps Predict.fun withdrawal adapter config disabled by default", () => {
    expect(getPredictFunWithdrawalConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: "DISABLED",
      instructionsUrl: "https://docs.predict.fun/knowledge-base/wallets",
      timeoutMs: 5_000,
      dryRunOnly: true,
      configured: false
    });
  });

  it("parses enabled dry-run config without enabling live mutation", () => {
    expect(getPredictFunWithdrawalConfigFromEnv({
      PREDICT_FUN_WITHDRAWAL_ADAPTER_ENABLED: "true",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_MODE: "USER_WALLET_DRY_RUN",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      PREDICT_FUN_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.predict.fun/knowledge-base/wallets",
      PREDICT_FUN_WITHDRAWAL_ADAPTER_TIMEOUT_MS: "7000"
    } as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      mode: "USER_WALLET_DRY_RUN",
      instructionsUrl: "https://docs.predict.fun/knowledge-base/wallets",
      timeoutMs: 7_000,
      dryRunOnly: true,
      configured: true
    });
  });

  it("prepares safe user-wallet instructions without backend signing data", async () => {
    const adapter = new PredictFunWithdrawalAdapter(enabledConfig, {
      now: () => new Date("2026-04-27T00:00:00.000Z")
    });

    const quote = await adapter.prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USDT",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    });
    const userAction = await adapter.prepareUserAction(quote);
    const serialized = JSON.stringify({ quote, userAction });

    expect(adapter.getWithdrawalCapabilities()).toMatchObject({
      venue: "PREDICT_FUN",
      classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: true,
      readinessStatus: "DRY_RUN_READY"
    });
    expect(quote).toMatchObject({
      provider: "PREDICT_FUN_USER_WALLET",
      sourceVenue: "PREDICT_FUN",
      destinationChain: "BSC",
      destinationToken: "USDT",
      amount: "40",
      estimatedFees: "0",
      instructionsUrl: "https://docs.predict.fun/knowledge-base/wallets"
    });
    expect(userAction).toMatchObject({
      actionType: "USER_COMPLETE_PREDICT_FUN_WALLET_WITHDRAWAL",
      walletModel: "PRIVY_ZERODEV",
      destinationChain: "BSC",
      destinationToken: "USDT",
      amount: "40"
    });
    expect(serialized).toContain("Lotus does not hold private keys");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("walletSeed");
    expect(serialized).not.toContain("privySecret");
    expect(serialized).not.toContain("zeroDevSigner");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("jwt");
    expect(serialized).not.toContain("rawProviderPayload");
  });

  it("refuses actions when disabled, not configured, or dry-run-only is unset", async () => {
    await expect(new PredictFunWithdrawalAdapter({
      ...enabledConfig,
      enabled: false,
      mode: "DISABLED",
      configured: false
    }).prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("PREDICT_FUN_WITHDRAWAL_ADAPTER_DISABLED");

    await expect(new PredictFunWithdrawalAdapter({
      ...enabledConfig,
      instructionsUrl: "not-a-url",
      configured: false
    }).prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("PREDICT_FUN_WITHDRAWAL_ADAPTER_NOT_CONFIGURED");

    await expect(new PredictFunWithdrawalAdapter({
      ...enabledConfig,
      dryRunOnly: false
    }).prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("PREDICT_FUN_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");
  });

  it("redacts environment secrets and forbidden provider internals", () => {
    expect(verifyPredictFunWithdrawalRedaction({
      provider: "PREDICT_FUN_USER_WALLET",
      mode: "USER_WALLET_DRY_RUN",
      walletModel: "PRIVY_ZERODEV"
    }, {
      PREDICT_FUN_API_KEY: "predict-secret",
      PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-secret",
      DATABASE_URL: "postgres://secret",
      TEST_DATABASE_URL: "postgres://test-secret"
    } as NodeJS.ProcessEnv)).toBe(true);

    expect(verifyPredictFunWithdrawalRedaction({
      authHeader: "Bearer predict-secret"
    }, {
      PREDICT_FUN_API_KEY: "predict-secret"
    } as NodeJS.ProcessEnv)).toBe(false);
  });
});
