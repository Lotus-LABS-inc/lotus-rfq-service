#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { InternalCrossingEngine } from "../src/core/internal-engine/engine.js";
import { OrderLockError } from "../src/core/internal-engine/locker.js";
import type { InternalOrder, RedisBookOrder } from "../src/core/internal-engine/types.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface QueryResponse<Row> {
  rows: Row[];
}

const makeIncomingOrder = (): InternalOrder => ({
  id: randomUUID(),
  market_id: randomUUID(),
  user_id: randomUUID(),
  side: "buy",
  price: "0.60",
  initial_size: "5",
  remaining_size: "5",
  status: "OPEN",
  created_at: new Date("2026-03-10T12:00:00.000Z"),
  updated_at: new Date("2026-03-10T12:00:00.000Z")
});

const makeMakerEntry = (overrides: Partial<RedisBookOrder> = {}): RedisBookOrder => ({
  orderId: overrides.orderId ?? randomUUID(),
  marketId: overrides.marketId ?? randomUUID(),
  side: overrides.side ?? "sell",
  member: overrides.member ?? `000000000000001:${overrides.orderId ?? randomUUID()}`,
  price: overrides.price ?? "0.60",
  remaining: overrides.remaining ?? "5",
  userId: overrides.userId ?? randomUUID(),
  createdAtMs: overrides.createdAtMs ?? Date.now()
});

const makeLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger)
});

const makePoolClient = (
  query: (sql: string, params?: unknown[]) => Promise<QueryResponse<Record<string, unknown>>>
): PoolClient =>
  ({
    query: query as unknown as PoolClient["query"],
    release: () => undefined
  } as unknown as PoolClient);

const runLockContentionScenario = async (): Promise<void> => {
  const engine = new InternalCrossingEngine(
    { connect: async () => { throw new Error("should_not_connect"); } } as unknown as Pool,
    { getBestOppositeOrders: async () => [makeMakerEntry()] } as never,
    {
      acquireDualOrderLocks: async () => {
        throw new OrderLockError(["maker", "taker"], 5);
      },
      releaseLocks: async () => undefined
    } as never,
    makeLogger() as Logger
  );

  await engine.attemptCross(makeIncomingOrder()).then(
    () => {
      throw new Error("lock contention scenario unexpectedly succeeded");
    },
    (error: unknown) => {
      if (!(error instanceof OrderLockError)) {
        throw error;
      }
    }
  );
};

const runRedisSyncFailureScenario = async (): Promise<void> => {
  const query = async (_sql: string): Promise<QueryResponse<Record<string, unknown>>> => ({ rows: [] });
  const engine = new InternalCrossingEngine(
    { connect: async () => makePoolClient(query) } as unknown as Pool,
    {
      getBestOppositeOrders: async () => [],
      removeOrder: async () => {
        throw new Error("simulated_redis_failure");
      },
      updateRemaining: async () => {
        throw new Error("simulated_redis_failure");
      }
    } as never,
    {
      acquireDualOrderLocks: async () => ({ lockIds: [], ownerId: "owner" }),
      releaseLocks: async () => undefined
    } as never,
    makeLogger() as Logger
  );

  const result = await engine.attemptCross(makeIncomingOrder());
  if (result.filledSize !== 0) {
    throw new Error("redis sync failure scenario unexpectedly filled");
  }
};

const runDbWriteFailureScenario = async (): Promise<void> => {
  let call = 0;
  const query = async (): Promise<QueryResponse<Record<string, unknown>>> => {
    call += 1;
    if (call === 2) {
      return {
        rows: [{
          id: "maker-order",
          user_id: randomUUID(),
          market_id: randomUUID(),
          side: "sell",
          price: "0.60",
          remaining_size: "5",
          status: "OPEN",
          created_at: new Date()
        }]
      };
    }
    if (call === 3) {
      return { rows: [{ id: "trade-1", created_at: new Date() }] };
    }
    if (call === 4) {
      throw new Error("update_maker_failed");
    }
    return { rows: [] };
  };
  const makerEntry = makeMakerEntry({ orderId: "maker-order", remaining: "5" });
  const engine = new InternalCrossingEngine(
    { connect: async () => makePoolClient(query) } as unknown as Pool,
    {
      getBestOppositeOrders: async () => [makerEntry],
      removeOrder: async () => true,
      updateRemaining: async () => makerEntry
    } as never,
    {
      acquireDualOrderLocks: async () => ({ lockIds: [], ownerId: "owner" }),
      releaseLocks: async () => undefined
    } as never,
    makeLogger() as Logger
  );

  await engine.attemptCross(makeIncomingOrder()).then(
    () => {
      throw new Error("db write failure scenario unexpectedly succeeded");
    },
    (error: unknown) => {
      if (!(error instanceof Error) || error.message !== "update_maker_failed") {
        throw error;
      }
    }
  );
};

const runStaleRedisScenario = async (): Promise<void> => {
  let calls = 0;
  const query = async (): Promise<QueryResponse<Record<string, unknown>>> => {
    calls += 1;
    if (calls === 2) {
      return { rows: [] };
    }
    return { rows: [] };
  };
  let removed = false;
  const engine = new InternalCrossingEngine(
    { connect: async () => makePoolClient(query) } as unknown as Pool,
    {
      getBestOppositeOrders: async () => [makeMakerEntry({ orderId: "stale-maker" })],
      removeOrder: async () => {
        removed = true;
        return true;
      }
    } as never,
    {
      acquireDualOrderLocks: async () => ({ lockIds: [], ownerId: "owner" }),
      releaseLocks: async () => undefined
    } as never,
    makeLogger() as Logger
  );

  await engine.attemptCross(makeIncomingOrder());
  if (!removed) {
    throw new Error("stale redis scenario failed to remove stale maker");
  }
};

const run = async (): Promise<void> => {
  await runLockContentionScenario();
  await runRedisSyncFailureScenario();
  await runDbWriteFailureScenario();
  await runStaleRedisScenario();
  logger.info("Internal-cross chaos scenarios passed.");
};

run().catch((error) => {
  logger.error({ err: error }, "Internal-cross chaos scenarios failed.");
  process.exit(1);
});
