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

  it("discovers existing EOA partner accounts through the public profile endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: 1338591,
      account: "0x1111111111111111111111111111111111111111"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = new LimitlessPartnerAccountClient({
      enabled: true,
      hmacTokenId: "token",
      hmacSecret: Buffer.from("secret").toString("base64"),
      baseUrl: "https://limitless.test"
    });

    const account = await client.getEoaPartnerAccount("0x1111111111111111111111111111111111111111");

    expect(account).toEqual({
      profileId: "1338591",
      account: "0x1111111111111111111111111111111111111111"
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://limitless.test/profiles/public/0x1111111111111111111111111111111111111111",
      expect.objectContaining({ method: "GET" })
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.stringify(init?.headers ?? {})).not.toContain("lmts-signature");
    expect(JSON.stringify(init?.headers ?? {})).not.toContain("token");
  });

  it("returns null when public profile discovery returns malformed data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: 1338591,
      account: "not-an-address"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = new LimitlessPartnerAccountClient({
      enabled: true,
      hmacTokenId: "token",
      hmacSecret: Buffer.from("secret").toString("base64"),
      baseUrl: "https://limitless.test"
    });

    await expect(client.getEoaPartnerAccount("0x1111111111111111111111111111111111111111")).resolves.toBeNull();
  });

  it("returns null when public profile discovery has no profile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      message: "not found"
    }), {
      status: 404,
      headers: { "content-type": "application/json" }
    }));
    const client = new LimitlessPartnerAccountClient({
      enabled: true,
      hmacTokenId: "token",
      hmacSecret: Buffer.from("secret").toString("base64"),
      baseUrl: "https://limitless.test"
    });

    await expect(client.getEoaPartnerAccount("0x1111111111111111111111111111111111111111")).resolves.toBeNull();
  });
});
