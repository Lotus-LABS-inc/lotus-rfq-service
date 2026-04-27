import { describe, expect, it } from "vitest";

import {
  runLimitlessSdkAuthDryRun,
  type LimitlessSdkHttpClientConstructor,
  type LimitlessSdkPortfolioFetcherConstructor
} from "../src/core/funding/limitless-sdk-auth-dry-run.js";

describe("Limitless SDK auth dry-run", () => {
  it("refuses incomplete HMAC config without attempting SDK reads", async () => {
    const captured = createSdkFakes();

    const artifact = await runLimitlessSdkAuthDryRun({
      env: {},
      sdk: captured.sdk,
      now: fixedNow
    });

    expect(artifact.status).toBe("REFUSED_CONFIG_INCOMPLETE");
    expect(artifact.calls.positions.attempted).toBe(false);
    expect(artifact.calls.history.attempted).toBe(false);
    expect(artifact.redactionVerified).toBe(true);
    expect(captured.httpConfigs).toHaveLength(0);
  });

  it("builds the SDK client with HMAC credentials and x-on-behalf-of when configured", async () => {
    const captured = createSdkFakes();

    const artifact = await runLimitlessSdkAuthDryRun({
      env: {
        LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL: "https://api.limitless.exchange",
        LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY: "token-secret-value",
        LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET: "hmac-secret-value",
        LIMITLESS_WITHDRAWAL_ADAPTER_ON_BEHALF_OF_PROFILE_ID: "1291576",
        LIMITLESS_WITHDRAWAL_ADAPTER_TIMEOUT_MS: "9000"
      } as NodeJS.ProcessEnv,
      sdk: captured.sdk,
      now: fixedNow
    });

    expect(artifact.status).toBe("COMPLETED");
    expect(captured.httpConfigs).toEqual([{
      baseURL: "https://api.limitless.exchange",
      timeout: 9_000,
      hmacCredentials: {
        tokenId: "token-secret-value",
        secret: "hmac-secret-value"
      },
      additionalHeaders: {
        "x-on-behalf-of": "1291576"
      }
    }]);
    expect(artifact.calls.positions).toMatchObject({
      attempted: true,
      ok: true,
      summary: {
        clobCount: 1,
        ammCount: 1,
        hasAccumulativePoints: true
      }
    });
    expect(artifact.calls.history).toMatchObject({
      attempted: true,
      ok: true,
      summary: {
        rowCount: 1,
        totalCount: 1,
        hasNextCursor: true
      }
    });
    expect(JSON.stringify(artifact)).not.toContain("token-secret-value");
    expect(JSON.stringify(artifact)).not.toContain("hmac-secret-value");
    expect(artifact.safety.liveVenueWithdrawalEndpointCalled).toBe(false);
    expect(artifact.safety.backendSignedTransaction).toBe(false);
    expect(artifact.safety.backendBroadcastedTransaction).toBe(false);
    expect(artifact.safety.completionPersisted).toBe(false);
  });

  it("attempts profile read only when a profile wallet address is configured", async () => {
    const captured = createSdkFakes();

    const withoutProfile = await runLimitlessSdkAuthDryRun({
      env: baseEnv(),
      sdk: captured.sdk,
      now: fixedNow
    });
    expect(withoutProfile.calls.profile.attempted).toBe(false);

    const withProfile = await runLimitlessSdkAuthDryRun({
      env: {
        ...baseEnv(),
        LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS: "0x2222222222222222222222222222222222222222"
      } as NodeJS.ProcessEnv,
      sdk: captured.sdk,
      now: fixedNow
    });
    expect(withProfile.calls.profile).toMatchObject({
      attempted: true,
      ok: true,
      summary: {
        idPresent: true,
        accountPresent: true,
        rankPresent: true
      }
    });
  });

  it("reports sanitized SDK errors without leaking credentials", async () => {
    const captured = createSdkFakes({
      getPositions: async () => {
        throw {
          name: "LimitlessApiError",
          response: {
            status: 400,
            data: {
              code: "BAD_PROFILE",
              message: "profile is invalid for token-secret-value"
            }
          }
        };
      }
    });

    const artifact = await runLimitlessSdkAuthDryRun({
      env: baseEnv(),
      sdk: captured.sdk,
      now: fixedNow
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.calls.positions.error).toMatchObject({
      name: "LimitlessApiError",
      status: 400,
      code: "BAD_PROFILE"
    });
    expect(artifact.redactionVerified).toBe(true);
    expect(JSON.stringify(artifact)).not.toContain("hmac-secret-value");
    expect(JSON.stringify(artifact)).not.toContain("lmts-signature");
    expect(JSON.stringify(artifact)).not.toContain("authorization");
  });

  it("falls back to SDK HttpClient history read when the SDK helper sends rejected page params", async () => {
    const httpGets: string[] = [];
    const captured = createSdkFakes({
      getUserHistory: async () => {
        throw {
          response: {
            status: 400,
            data: {
              code: "Bad Request",
              message: "field: page, message: property page should not exist"
            }
          }
        };
      },
      httpGet: async (url) => {
        httpGets.push(url);
        return {
          data: [{ id: "history-row" }],
          totalCount: 1
        };
      }
    });

    const artifact = await runLimitlessSdkAuthDryRun({
      env: baseEnv(),
      sdk: captured.sdk,
      now: fixedNow
    });

    expect(artifact.status).toBe("COMPLETED");
    expect(httpGets).toEqual(["/portfolio/history?limit=25"]);
    expect(artifact.calls.history.summary).toMatchObject({
      source: "HttpClient.get:/portfolio/history?limit=25",
      fallbackUsed: true,
      rowCount: 1
    });
  });
});

const fixedNow = () => new Date("2026-04-26T00:00:00.000Z");

const baseEnv = (): NodeJS.ProcessEnv => ({
  LIMITLESS_WITHDRAWAL_ADAPTER_BASE_URL: "https://api.limitless.exchange",
  LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY: "token-secret-value",
  LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET: "hmac-secret-value"
} as NodeJS.ProcessEnv);

const createSdkFakes = (overrides: Partial<{
  getPositions: () => Promise<unknown>;
  getUserHistory: (page?: number, limit?: number) => Promise<unknown>;
  getProfile: (address: string) => Promise<unknown>;
  httpGet: (url: string) => Promise<unknown>;
}> = {}) => {
  const httpConfigs: unknown[] = [];

  const HttpClient = class {
    constructor(config: unknown) {
      httpConfigs.push(config);
    }

    get = overrides.httpGet;
  } as LimitlessSdkHttpClientConstructor;

  const PortfolioFetcher = class {
    getPositions = overrides.getPositions ?? (async () => ({
      clob: [{ id: "clob-position" }],
      amm: [{ id: "amm-position" }],
      accumulativePoints: "1"
    }));

    getUserHistory = overrides.getUserHistory ?? (async () => ({
      data: [{ id: "history-row" }],
      totalCount: 1,
      nextCursor: "next"
    }));

    getProfile = overrides.getProfile ?? (async () => ({
      id: "profile-id",
      account: "0x2222222222222222222222222222222222222222",
      rank: 1
    }));
  } as LimitlessSdkPortfolioFetcherConstructor;

  return {
    httpConfigs,
    sdk: {
      HttpClient,
      PortfolioFetcher
    }
  };
};
