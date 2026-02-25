import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createLPAuthMiddleware, type LPAuthenticatedRequest } from "../src/lp/lp-auth-middleware.js";

interface LPKeyRecord {
  id: string;
  lp_id: string;
  key_id: string;
  public_key: string;
  secret_hash: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

class FakeRedis {
  private readonly values = new Map<string, string>();

  public async set(
    key: string,
    value: string,
    _mode: "EX" | "PX",
    _duration: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition === "NX" && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    return "OK";
  }
}

const sign = (
  secret: string,
  timestamp: string,
  nonce: string,
  method: string,
  url: string,
  body: unknown
): string => {
  const serializedBody = typeof body === "string" ? body : JSON.stringify(body);
  const payload = `${timestamp}.${nonce}.${method.toUpperCase()}.${url}.${serializedBody}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
};

const activeKeyRecord: LPKeyRecord = {
  id: "1",
  lp_id: "lp-1",
  key_id: "api-key-1",
  public_key: "pub",
  secret_hash: "shared-secret",
  status: "ACTIVE",
  metadata: {},
  created_at: new Date("2026-02-25T00:00:00.000Z"),
  updated_at: new Date("2026-02-25T00:00:00.000Z")
};

describe("LP auth middleware", () => {
  it("authorizes request with valid headers, signature, timestamp, and nonce", async () => {
    const redis = new FakeRedis();
    const findByKeyId = vi.fn(async (keyId: string) =>
      keyId === "api-key-1" ? (activeKeyRecord as never) : null
    );

    const app = Fastify({ logger: false });
    app.post(
      "/lp/protected",
      {
        preHandler: createLPAuthMiddleware({
          redisClient: redis as never,
          lpKeyRepository: { findByKeyId },
          logger: { warn: vi.fn() }
        })
      },
      async (request) => {
        const auth = (request as LPAuthenticatedRequest).lpAuth;
        return { ok: true, lpId: auth.lpId, keyId: auth.keyId };
      }
    );

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "nonce-1";
    const payload = { sample: "value" };
    const signature = sign(
      "shared-secret",
      timestamp,
      nonce,
      "POST",
      "/lp/protected",
      payload
    );

    const response = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload,
      headers: {
        "x-api-key": "api-key-1",
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, lpId: "lp-1", keyId: "api-key-1" });
    await app.close();
  });

  it("rejects missing auth headers", async () => {
    const app = Fastify({ logger: false });
    app.post(
      "/lp/protected",
      {
        preHandler: createLPAuthMiddleware({
          redisClient: new FakeRedis() as never,
          lpKeyRepository: { findByKeyId: vi.fn(async () => null) },
          logger: { warn: vi.fn() }
        })
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload: { a: 1 }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects timestamp outside allowed skew", async () => {
    const app = Fastify({ logger: false });
    const redis = new FakeRedis();
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 1000).toString();
    const nonce = "nonce-stale";
    const signature = sign(
      "shared-secret",
      oldTimestamp,
      nonce,
      "POST",
      "/lp/protected",
      { a: 1 }
    );

    app.post(
      "/lp/protected",
      {
        preHandler: createLPAuthMiddleware({
          redisClient: redis as never,
          lpKeyRepository: {
            findByKeyId: vi.fn(async () => activeKeyRecord as never)
          },
          logger: { warn: vi.fn() },
          allowedClockSkewSeconds: 30
        })
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload: { a: 1 },
      headers: {
        "x-api-key": "api-key-1",
        "x-signature": signature,
        "x-timestamp": oldTimestamp,
        "x-nonce": nonce
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects invalid signature", async () => {
    const app = Fastify({ logger: false });

    app.post(
      "/lp/protected",
      {
        preHandler: createLPAuthMiddleware({
          redisClient: new FakeRedis() as never,
          lpKeyRepository: {
            findByKeyId: vi.fn(async () => activeKeyRecord as never)
          },
          logger: { warn: vi.fn() }
        })
      },
      async () => ({ ok: true })
    );

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const response = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload: { a: 1 },
      headers: {
        "x-api-key": "api-key-1",
        "x-signature": "bad-signature",
        "x-timestamp": timestamp,
        "x-nonce": "nonce-bad"
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects nonce replay using redis SETNX semantics", async () => {
    const app = Fastify({ logger: false });
    const redis = new FakeRedis();

    app.post(
      "/lp/protected",
      {
        preHandler: createLPAuthMiddleware({
          redisClient: redis as never,
          lpKeyRepository: {
            findByKeyId: vi.fn(async () => activeKeyRecord as never)
          },
          logger: { warn: vi.fn() }
        })
      },
      async () => ({ ok: true })
    );

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "nonce-replay";
    const payload = { a: 1 };
    const signature = sign(
      "shared-secret",
      timestamp,
      nonce,
      "POST",
      "/lp/protected",
      payload
    );

    const first = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload,
      headers: {
        "x-api-key": "api-key-1",
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/lp/protected",
      payload,
      headers: {
        "x-api-key": "api-key-1",
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    await app.close();
  });
});

