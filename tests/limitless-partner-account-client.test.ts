import { afterEach, describe, expect, it, vi } from "vitest";
import { LimitlessPartnerAccountClient } from "../src/integrations/limitless/limitless-partner-account-client.js";

describe("Limitless partner account client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses unix millisecond HMAC timestamps when configured from the adapter format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      profileId: "12345",
      account: "0x1111111111111111111111111111111111111111"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = new LimitlessPartnerAccountClient({
      enabled: true,
      hmacTokenId: "token",
      hmacSecret: Buffer.from("secret").toString("base64"),
      hmacTimestampFormat: "UNIX_MS",
      baseUrl: "https://limitless.test"
    });

    await client.createEoaPartnerAccount({
      account: "0x1111111111111111111111111111111111111111",
      signingMessage: "Sign",
      signature: `0x${"a".repeat(130)}`
    });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)["lmts-timestamp"]).toBe("1778846400000");
  });
});
