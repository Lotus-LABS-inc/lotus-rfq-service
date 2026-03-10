import { describe, expect, it } from "vitest";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import type { InternalOrder } from "../../src/core/internal-engine/types.js";
import type { RedisClient } from "../../src/db/redis.js";

interface StoredZSetEntry {
  member: string;
  score: number;
}

class InMemoryRedisClient implements RedisClient {
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, StoredZSetEntry[]>();

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

  async set(key: string, value: string): Promise<"OK" | null> {
    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
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
    let count = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) {
        count += 1;
      }
    }
    return count;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.zsets.get(key) ?? [];
    const filtered = entries.filter((entry) => entry.member !== member);
    filtered.push({ member, score });
    filtered.sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.member.localeCompare(right.member);
    });
    this.zsets.set(key, filtered);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    const entries = this.zsets.get(key) ?? [];
    const filtered = entries.filter((entry) => entry.member !== member);
    this.zsets.set(key, filtered);
    return filtered.length === entries.length ? 0 : 1;
  }

  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    _limitLiteral?: "LIMIT",
    offset?: number,
    count?: number
  ): Promise<string[]> {
    const minValue = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    const maxValue = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
    const start = offset ?? 0;
    const size = count ?? Number.MAX_SAFE_INTEGER;
    return (this.zsets.get(key) ?? [])
      .filter((entry) => entry.score >= minValue && entry.score <= maxValue)
      .slice(start, start + size)
      .map((entry) => entry.member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return (this.zsets.get(key) ?? [])
      .slice()
      .reverse()
      .slice(start, stop + 1)
      .map((entry) => entry.member);
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

  getZSetMembers(key: string): string[] {
    return (this.zsets.get(key) ?? []).map((entry) => entry.member);
  }
}

const makeOrder = (overrides: Partial<InternalOrder> = {}): InternalOrder => ({
  id: overrides.id ?? "order-1",
  market_id: overrides.market_id ?? "market-1",
  user_id: overrides.user_id ?? "user-1",
  side: overrides.side ?? "buy",
  price: overrides.price ?? "1.50",
  initial_size: overrides.initial_size ?? "10",
  remaining_size: overrides.remaining_size ?? "10",
  status: overrides.status ?? "OPEN",
  created_at: overrides.created_at ?? new Date("2026-03-10T10:00:00.000Z"),
  updated_at: overrides.updated_at ?? new Date("2026-03-10T10:00:00.000Z")
});

describe("OrderBook", () => {
  it("adds orders and preserves FIFO ordering at the same price", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);
    const earlier = makeOrder({
      id: "order-earlier",
      side: "sell",
      price: "1.25",
      created_at: new Date("2026-03-10T10:00:00.000Z")
    });
    const later = makeOrder({
      id: "order-later",
      side: "sell",
      price: "1.25",
      created_at: new Date("2026-03-10T10:00:01.000Z")
    });

    await orderBook.addOrder(later);
    await orderBook.addOrder(earlier);

    const best = await orderBook.getBestOppositeOrders("market-1", "buy", "1.25");

    expect(best.map((entry) => entry.orderId)).toEqual(["order-earlier", "order-later"]);
  });

  it("prioritizes better prices before earlier worse prices", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);

    await orderBook.addOrder(
      makeOrder({
        id: "buy-best",
        side: "buy",
        price: "1.60",
        created_at: new Date("2026-03-10T10:00:02.000Z")
      })
    );
    await orderBook.addOrder(
      makeOrder({
        id: "buy-worse",
        side: "buy",
        price: "1.50",
        created_at: new Date("2026-03-10T10:00:01.000Z")
      })
    );

    const best = await orderBook.getBestOppositeOrders("market-1", "sell", "1.40");

    expect(best.map((entry) => entry.orderId)).toEqual(["buy-best", "buy-worse"]);
  });

  it("removes both zset and sidecar metadata by order id", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);
    const order = makeOrder({ id: "remove-me", side: "sell" });

    await orderBook.addOrder(order);

    expect(await orderBook.removeOrder("remove-me")).toBe(true);
    expect(await redis.get("book:order:remove-me")).toBeNull();
    expect(redis.getZSetMembers("book:market-1:SELL")).toEqual([]);
  });

  it("updates remaining quantity without disturbing ranking", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);

    await orderBook.addOrder(
      makeOrder({
        id: "first",
        side: "sell",
        price: "1.20",
        created_at: new Date("2026-03-10T10:00:00.000Z")
      })
    );
    await orderBook.addOrder(
      makeOrder({
        id: "second",
        side: "sell",
        price: "1.20",
        created_at: new Date("2026-03-10T10:00:01.000Z")
      })
    );

    const updated = await orderBook.updateRemaining("first", "4.5");
    const best = await orderBook.getBestOppositeOrders("market-1", "buy", "1.20");

    expect(updated?.remaining).toBe("4.5");
    expect(best.map((entry) => entry.orderId)).toEqual(["first", "second"]);
    expect(best[0]?.remaining).toBe("4.5");
  });

  it("cleans stale zset members when sidecar metadata is missing", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);
    await redis.zadd("book:market-1:SELL", 1.2, "000000000000001:stale-order");

    const best = await orderBook.getBestOppositeOrders("market-1", "buy", "1.20");

    expect(best).toEqual([]);
    expect(redis.getZSetMembers("book:market-1:SELL")).toEqual([]);
  });

  it("returns safe null/false for unknown order ids", async () => {
    const redis = new InMemoryRedisClient();
    const orderBook = new OrderBook(redis);

    expect(await orderBook.removeOrder("missing")).toBe(false);
    expect(await orderBook.updateRemaining("missing", "2")).toBeNull();
  });
});
