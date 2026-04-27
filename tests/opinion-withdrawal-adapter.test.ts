import { describe, expect, it } from "vitest";

import {
  getOpinionWithdrawalConfigFromEnv,
  OpinionSafeWithdrawalAdapter,
  verifyOpinionWithdrawalRedaction
} from "../src/core/funding/opinion-withdrawal-adapter.js";

const enabledConfig = {
  enabled: true,
  mode: "USER_SAFE_DRY_RUN" as const,
  instructionsUrl: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem",
  timeoutMs: 5_000,
  dryRunOnly: true,
  configured: true
};

describe("Opinion withdrawal Safe dry-run adapter", () => {
  it("keeps Opinion withdrawal adapter config disabled by default", () => {
    expect(getOpinionWithdrawalConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: "DISABLED",
      instructionsUrl: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem",
      timeoutMs: 5_000,
      dryRunOnly: true,
      configured: false
    });
  });

  it("parses enabled dry-run config without enabling live mutation", () => {
    expect(getOpinionWithdrawalConfigFromEnv({
      OPINION_WITHDRAWAL_ADAPTER_ENABLED: "true",
      OPINION_WITHDRAWAL_ADAPTER_MODE: "USER_SAFE_DRY_RUN",
      OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY: "true",
      OPINION_WITHDRAWAL_INSTRUCTIONS_URL: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem",
      OPINION_WITHDRAWAL_ADAPTER_TIMEOUT_MS: "7000"
    } as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      mode: "USER_SAFE_DRY_RUN",
      instructionsUrl: "https://docs.opinion.trade/developer-guide/opinion-clob-typescript-sdk/builder-mode/split-merge-redeem",
      timeoutMs: 7_000,
      dryRunOnly: true,
      configured: true
    });
  });

  it("prepares safe Opinion BSC USDT user-Safe instructions without backend signing data", async () => {
    const adapter = new OpinionSafeWithdrawalAdapter(enabledConfig, {
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
      venue: "OPINION",
      classification: "USER_SAFE_AUTHORIZED_ACTION_CANDIDATE",
      supportsApiInitiatedWithdrawal: false,
      supportsUserBroadcastReference: true,
      readinessStatus: "DRY_RUN_READY"
    });
    expect(quote).toMatchObject({
      provider: "OPINION_SAFE_USER_ACTION",
      sourceVenue: "OPINION",
      destinationChain: "BSC",
      destinationToken: "USDT",
      amount: "40",
      estimatedFees: "0"
    });
    expect(userAction).toMatchObject({
      actionType: "USER_COMPLETE_OPINION_SAFE_WITHDRAWAL",
      walletModel: "GNOSIS_SAFE_OR_USER_EOA",
      destinationChain: "BSC",
      destinationToken: "USDT",
      amount: "40"
    });
    expect(serialized).toContain("Lotus does not hold private keys");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("safeOwnerKey");
    expect(serialized).not.toContain("gnosisSafeSigner");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("sessionToken");
    expect(serialized).not.toContain("rawProviderPayload");
  });

  it("refuses disabled, unsafe, or non-BSC-USDT actions", async () => {
    await expect(new OpinionSafeWithdrawalAdapter({
      ...enabledConfig,
      enabled: false,
      mode: "DISABLED",
      configured: false
    }).prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USDT",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("OPINION_WITHDRAWAL_ADAPTER_DISABLED");

    await expect(new OpinionSafeWithdrawalAdapter({
      ...enabledConfig,
      dryRunOnly: false
    }).prepareWithdrawalQuote({
      destinationChain: "BSC",
      destinationToken: "USDT",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("OPINION_WITHDRAWAL_ADAPTER_DRY_RUN_ONLY_REQUIRED");

    await expect(new OpinionSafeWithdrawalAdapter(enabledConfig).prepareWithdrawalQuote({
      destinationChain: "POLYGON",
      destinationToken: "USDC",
      destinationAddress: "0x1111111111111111111111111111111111111111",
      amount: "40"
    })).rejects.toThrow("OPINION_WITHDRAWAL_BSC_USDT_REQUIRED");
  });

  it("redacts environment secrets and forbidden provider internals", () => {
    expect(verifyOpinionWithdrawalRedaction({
      provider: "OPINION_SAFE_USER_ACTION",
      mode: "USER_SAFE_DRY_RUN",
      walletModel: "GNOSIS_SAFE_OR_USER_EOA"
    }, {
      OPINION_API_KEY: "opinion-secret",
      OPINION_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-secret",
      DATABASE_URL: "postgres://secret",
      TEST_DATABASE_URL: "postgres://test-secret"
    } as NodeJS.ProcessEnv)).toBe(true);

    expect(verifyOpinionWithdrawalRedaction({
      authHeader: "Bearer opinion-secret"
    }, {
      OPINION_API_KEY: "opinion-secret"
    } as NodeJS.ProcessEnv)).toBe(false);
  });
});
