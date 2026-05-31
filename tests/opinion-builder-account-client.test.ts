import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOpinionBuilderAccountClientFromEnv } from "../src/integrations/opinion/opinion-builder-account-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildOpinionBuilderAccountClientFromEnv", () => {
  it("uses OPINION_BUILDER_API_KEY for builder account setup", () => {
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true",
      OPINION_BUILDER_API_KEY: "builder-opinion-api-key"
    } as NodeJS.ProcessEnv);

    expect(client.accountSetupEnabled()).toBe(true);
    expect(client.configured()).toBe(true);
  });

  it("does not use OPINION_API_KEY as the builder API key fallback", () => {
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true",
      OPINION_API_KEY: "sdk-opinion-api-key"
    } as NodeJS.ProcessEnv);

    expect(client.accountSetupEnabled()).toBe(true);
    expect(client.configured()).toBe(false);
  });

  it("stays unconfigured when setup is enabled without any Opinion API key", () => {
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true"
    } as NodeJS.ProcessEnv);

    expect(client.accountSetupEnabled()).toBe(true);
    expect(client.configured()).toBe(false);
  });

  it("uses the internal builder service when configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      walletAddress: "0x1111111111111111111111111111111111111111",
      multiSigWallet: "0x2222222222222222222222222222222222222222",
      builderName: "lotus",
      enableTrading: false,
      userApiKeyCreated: false,
      walletCreationTxHashPresent: true,
      apikey: "must-not-be-used"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true",
      OPINION_BUILDER_SERVICE_URL: "https://lotus-opinion-builder.example",
      OPINION_BUILDER_SERVICE_API_KEY: "internal-service-token"
    } as NodeJS.ProcessEnv);

    const result = await client.createOrRecoverSafe({
      walletAddress: "0x1111111111111111111111111111111111111111"
    });

    expect(client.configured()).toBe(true);
    expect(result).toEqual({
      walletAddress: "0x1111111111111111111111111111111111111111",
      multiSigWallet: "0x2222222222222222222222222222222222222222",
      builderName: "lotus",
      enableTrading: false,
      userApiKeyCreated: false,
      walletCreationTxHashPresent: true
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://lotus-opinion-builder.example/lotus/opinion/builder/safe"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer internal-service-token"
        })
      })
    );
  });
});
