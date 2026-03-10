import { describe, expect, it } from "vitest";
import { OrderLockError, OrderLocker } from "../../src/core/internal-engine/locker.js";
import type { RedisClient } from "../../src/db/redis.js";

class InMemoryLockRedisClient implements RedisClient {
  private readonly values = new Map<string, string>();
  public readonly setCalls: string[] = [];
  public readonly deletedKeys: string[] = [];
  private readonly failedKeys = new Map<string, number>();

  setFailures(key: string, failures: number): void {
    this.failedKeys.set(key, failures);
  }

  seedLock(key: string, owner: string): void {
    this.values.set(key, owner);
  }

  async connect(): Promise<unknown> {
    return undefined;
  }

  async quit(): Promise<string> {
    return "OK";
  }

  duplicate(): RedisClient {
    return this;
  }

  async publish(): Promise<number> {
    return 0;
  }

  async subscribe(): Promise<number> {
    return 0;
  }

  async unsubscribe(): Promise<number> {
    return 0;
  }

  async set(
    key: string,
    value: string,
    _mode: "EX" | "PX",
    _duration: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    this.setCalls.push(key);

    const remainingFailures = this.failedKeys.get(key) ?? 0;
    if (remainingFailures > 0) {
      this.failedKeys.set(key, remainingFailures - 1);
      return null;
    }

    if (condition === "NX" && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async incrbyfloat(): Promise<string> {
    return "0";
  }

  async eval(): Promise<unknown> {
    return undefined;
  }

  async expire(): Promise<number> {
    return 1;
  }

  async ttl(): Promise<number> {
    return -1;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      this.deletedKeys.push(key);
      if (this.values.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async zadd(): Promise<number> {
    return 0;
  }

  async zrem(): Promise<number> {
    return 0;
  }

  async zrangebyscore(): Promise<string[]> {
    return [];
  }

  async zrevrange(): Promise<string[]> {
    return [];
  }

  async hset(): Promise<number> {
    return 0;
  }

  async hget(): Promise<string | null> {
    return null;
  }

  async hdel(): Promise<number> {
    return 0;
  }

  async psubscribe(): Promise<number> {
    return 0;
  }

  async punsubscribe(): Promise<number> {
    return 0;
  }

  on(): RedisClient {
    return this;
  }

  off(): RedisClient {
    return this;
  }
}

describe("OrderLocker", () => {
  it("always acquires the smaller UUID first", async () => {
    const redis = new InMemoryLockRedisClient();
    const locker = new OrderLocker(redis, {
      sleep: async () => undefined
    });

    await locker.acquireDualOrderLocks("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    expect(redis.setCalls.slice(0, 2)).toEqual([
      "lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "lock:order:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    ]);
  });

  it("releases the first lock when the second acquisition fails and retries with backoff", async () => {
    const redis = new InMemoryLockRedisClient();
    const sleepCalls: number[] = [];
    redis.setFailures("lock:order:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", 1);

    const locker = new OrderLocker(redis, {
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      }
    });

    const handle = await locker.acquireDualOrderLocks(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );

    expect(redis.deletedKeys).toContain("lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(sleepCalls).toEqual([50]);
    expect(handle.lockIds).toEqual([
      "lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "lock:order:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    ]);
  });

  it("throws a deterministic error after max retries", async () => {
    const redis = new InMemoryLockRedisClient();
    redis.seedLock("lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "other-owner");
    const sleepCalls: number[] = [];
    const locker = new OrderLocker(redis, {
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      }
    });

    await expect(
      locker.acquireDualOrderLocks(
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
      )
    ).rejects.toEqual(
      expect.objectContaining({
        name: "OrderLockError",
        orderIds: [
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        ],
        attempts: 5,
        message:
          "Unable to acquire locks for orders after 5 attempts: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
      })
    );

    expect(sleepCalls).toEqual([50, 100, 200, 400]);
  });

  it("releases only locks still owned by the same worker", async () => {
    const redis = new InMemoryLockRedisClient();
    const locker = new OrderLocker(redis, {
      sleep: async () => undefined
    });

    const handle = await locker.acquireDualOrderLocks(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );

    redis.seedLock("lock:order:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "different-owner");
    await locker.releaseLocks(handle);

    expect(await redis.get("lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeNull();
    expect(await redis.get("lock:order:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe("different-owner");
  });

  it("dedupes identical order ids into a single lock", async () => {
    const redis = new InMemoryLockRedisClient();
    const locker = new OrderLocker(redis, {
      sleep: async () => undefined
    });

    const handle = await locker.acquireDualOrderLocks(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    );

    expect(handle.lockIds).toEqual(["lock:order:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
  });
});
