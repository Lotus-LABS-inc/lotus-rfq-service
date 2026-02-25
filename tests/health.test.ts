import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { buildServer } from "../src/api/server.js";
import type { RedisClient } from "../src/db/redis.js";
import { startService } from "../src/index.js";
import { loadEnv } from "../src/utils/env.js";
import type { AppDb } from "../src/db/postgres.js";

const createTestLogger = (): Logger => {
  return pino({ level: "silent" });
};

const createRedisStub = (): RedisClient => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const client: RedisClient = {
    connect: async () => undefined,
    quit: async () => "OK",
    duplicate: () => client,
    publish: async () => 1,
    subscribe: async () => 1,
    unsubscribe: async () => 1,
    set: async () => "OK",
    get: async () => null,
    expire: async () => 1,
    ttl: async () => 60,
    del: async () => 1,
    zadd: async () => 1,
    zrevrange: async () => [],
    psubscribe: async () => 1,
    punsubscribe: async () => 1,
    on: ((event: string, listener: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(listener);
      listeners.set(event, handlers);
      return client;
    }) as RedisClient["on"],
    off: ((event: string, listener: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event) ?? [];
      listeners.set(
        event,
        handlers.filter((candidate) => candidate !== listener)
      );
      return client;
    }) as RedisClient["off"]
  };

  return client;
};

describe("infrastructure scaffold", () => {
  it("GET /health returns 200 and expected payload", async () => {
    const app = await buildServer({
      logger: createTestLogger(),
      redisClient: createRedisStub(),
      pgPool: {} as unknown as Pool,
      db: {} as AppDb,
      canonicalServiceBaseUrl: "http://localhost:4001"
    });

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "lotus-rfq-service"
    });

    await app.close();
  });

  it("env parsing succeeds with required variables", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "3030",
      LOG_LEVEL: "info",
      REDIS_URL: "redis://localhost:6379",
      CANONICAL_SERVICE_BASE_URL: "http://localhost:4001",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq"
    });

    expect(env.PORT).toBe(3030);
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("env parsing fails when database urls are missing", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "3030",
        LOG_LEVEL: "info",
        REDIS_URL: "redis://localhost:6379"
      })
    ).toThrow();
  });

  it("server factory builds without opening a network listener", async () => {
    const app = await buildServer({
      logger: createTestLogger(),
      redisClient: createRedisStub(),
      pgPool: {} as unknown as Pool,
      db: {} as AppDb,
      canonicalServiceBaseUrl: "http://localhost:4001"
    });

    expect(app.server.listening).toBe(false);
    await app.close();
  });
});

describe("bootstrap lifecycle", () => {
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
  });

  it("initializes dependencies in expected order", async () => {
    const mockApp = {
      listen: vi.fn(async () => {
        callOrder.push("listen");
      }),
      close: vi.fn(async () => {
        callOrder.push("app.close");
      })
    } as unknown as FastifyInstance;

    const runtime = await startService({
      loadEnv: () => {
        callOrder.push("loadEnv");
        return {
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          PORT: 3001,
          LOG_LEVEL: "info",
          REDIS_URL: "redis://localhost:6379",
          CANONICAL_SERVICE_BASE_URL: "http://localhost:4001",
          DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq"
        };
      },
      createLogger: () => {
        callOrder.push("createLogger");
        return createTestLogger();
      },
      createRedisClient: () => {
        callOrder.push("createRedisClient");
        return {} as unknown as RedisClient;
      },
      connectRedis: async () => {
        callOrder.push("connectRedis");
      },
      createPgPool: () => {
        callOrder.push("createPgPool");
        return {} as unknown as Pool;
      },
      createDrizzleDb: () => {
        callOrder.push("createDrizzleDb");
        return {} as AppDb;
      },
      buildServer: async () => {
        callOrder.push("buildServer");
        return mockApp;
      },
      disconnectRedis: async () => {
        callOrder.push("disconnectRedis");
      },
      closePgPool: async () => {
        callOrder.push("closePgPool");
      }
    });

    expect(callOrder).toEqual([
      "loadEnv",
      "createLogger",
      "createRedisClient",
      "connectRedis",
      "createPgPool",
      "createDrizzleDb",
      "buildServer",
      "listen"
    ]);

    await runtime.shutdown();
  });

  it("shutdown closes app, redis, and postgres", async () => {
    const mockApp = {
      listen: vi.fn(async () => {}),
      close: vi.fn(async () => {
        callOrder.push("app.close");
      })
    } as unknown as FastifyInstance;

    const runtime = await startService({
      loadEnv: () => ({
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: 3002,
        LOG_LEVEL: "info",
        REDIS_URL: "redis://localhost:6379",
        CANONICAL_SERVICE_BASE_URL: "http://localhost:4001",
        DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lotus_rfq"
      }),
      createLogger: () => createTestLogger(),
      createRedisClient: () => ({} as unknown as RedisClient),
      connectRedis: async () => {},
      createPgPool: () => ({} as unknown as Pool),
      createDrizzleDb: () => ({} as AppDb),
      buildServer: async () => mockApp,
      disconnectRedis: async () => {
        callOrder.push("disconnectRedis");
      },
      closePgPool: async () => {
        callOrder.push("closePgPool");
      }
    });

    await runtime.shutdown();
    expect(callOrder).toEqual(["app.close", "disconnectRedis", "closePgPool"]);
  });
});
