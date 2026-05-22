import { describe, expect, it } from "vitest";
import { buildOpinionBuilderAccountClientFromEnv } from "../src/integrations/opinion/opinion-builder-account-client.js";

describe("buildOpinionBuilderAccountClientFromEnv", () => {
  it("uses OPINION_API_KEY as the builder API key fallback", () => {
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true",
      OPINION_API_KEY: "shared-opinion-api-key"
    } as NodeJS.ProcessEnv);

    expect(client.accountSetupEnabled()).toBe(true);
    expect(client.configured()).toBe(true);
  });

  it("stays unconfigured when setup is enabled without any Opinion API key", () => {
    const client = buildOpinionBuilderAccountClientFromEnv({
      OPINION_BUILDER_ACCOUNT_SETUP_ENABLED: "true"
    } as NodeJS.ProcessEnv);

    expect(client.accountSetupEnabled()).toBe(true);
    expect(client.configured()).toBe(false);
  });
});
