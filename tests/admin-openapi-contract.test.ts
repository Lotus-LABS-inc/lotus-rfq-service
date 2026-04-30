import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("admin OpenAPI contract", () => {
  it("documents the admin frontend backend surface", async () => {
    const openApi = await readFile(new URL("../docs/api/openapi.yaml", import.meta.url), "utf8");
    for (const path of [
      "/admin/auth/login:",
      "/admin/auth/request-login-link:",
      "/admin/auth/magic-login:",
      "/admin/auth/me:",
      "/admin/auth/members:",
      "/admin/auth/members/{memberId}/invite:",
      "/admin/ops/summary:",
      "/admin/executions:",
      "/admin/funding/summary:",
      "/admin/monetization/summary:",
      "/admin/monetization/ledger:",
      "/admin/monetization/policies:",
      "/admin/schema-map:"
    ]) {
      expect(openApi).toContain(path);
    }
    expect(openApi).toContain("AdminLoginRequest:");
    expect(openApi).toContain("AdminRequestLoginLinkRequest:");
    expect(openApi).toContain("AdminRequestLoginLinkResponse:");
    expect(openApi).toContain("AdminMagicLoginRequest:");
    expect(openApi).toContain("AdminInvite:");
    expect(openApi).toContain("AdminMonetizationSummaryResponse:");
    expect(openApi).toContain("AdminSchemaMapResponse:");
  });
});
