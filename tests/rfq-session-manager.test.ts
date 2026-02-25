import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  RFQSessionManager,
  type RFQSessionRedisClient,
  type SessionExpiredEvent
} from "../src/core/rfq-engine/rfq-session-manager.js";

interface SortedSetEntry {
  score: number;
  member: string;
}

class FakeRedisClient extends EventEmitter implements RFQSessionRedisClient {
  private readonly values = new Map<string, string>();
  private readonly expirations = new Map<string, number>();
  private readonly zsets = new Map<string, SortedSetEntry[]>();
  private readonly subscriptions = new Set<string>();

  public async set(
    key: string,
    value: string,
    _mode: "EX" | "PX",
    duration: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition === "NX" && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    this.expirations.set(key, duration);
    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expirations.set(key, seconds);
    return 1;
  }

  public async ttl(key: string): Promise<number> {
    const ttl = this.expirations.get(key);
    return ttl ?? -1;
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        removed += 1;
      }
      this.expirations.delete(key);
    }
    return removed;
  }

  public async zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.zsets.get(key) ?? [];
    entries.push({ score, member });
    this.zsets.set(key, entries);
    return 1;
  }

  public async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const entries = [...(this.zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
    return entries.slice(start, stop + 1).map((entry) => entry.member);
  }

  public async psubscribe(pattern: string): Promise<number> {
    this.subscriptions.add(pattern);
    return this.subscriptions.size;
  }

  public async punsubscribe(pattern: string): Promise<number> {
    this.subscriptions.delete(pattern);
    return this.subscriptions.size;
  }

  public override on(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): this {
    return super.on(event, listener);
  }

  public override off(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void
  ): this {
    return super.off(event, listener);
  }
}

describe("RFQSessionManager", () => {
  it("stores metadata under rfq:{id}:meta with ttl", async () => {
    const redis = new FakeRedisClient();
    const manager = new RFQSessionManager({ redis });

    await manager.setSessionMetadata(
      "session-1",
      {
        id: "session-1",
        state: "CREATED",
        expiresAt: "2026-02-25T00:00:00.000Z",
        metadata: { source: "test" }
      },
      120
    );

    const loaded = await manager.getSessionMetadata("session-1");
    const ttl = await manager.getSessionTtl("session-1");

    expect(loaded?.id).toBe("session-1");
    expect(loaded?.state).toBe("CREATED");
    expect(ttl).toBe(120);
  });

  it("stores quotes under rfq:{id}:quotes sorted set and reads in score order", async () => {
    const redis = new FakeRedisClient();
    const manager = new RFQSessionManager({ redis });

    await manager.addQuote("session-2", {
      quoteId: "q1",
      score: 10,
      payload: { px: "1.2" }
    });
    await manager.addQuote("session-2", {
      quoteId: "q2",
      score: 30,
      payload: { px: "1.1" }
    });

    const quotes = await manager.listQuotes("session-2");
    expect(quotes.map((quote) => quote.quoteId)).toEqual(["q2", "q1"]);
  });

  it("refreshes ttl for metadata and quote keys", async () => {
    const redis = new FakeRedisClient();
    const manager = new RFQSessionManager({ redis });

    await manager.setSessionMetadata(
      "session-3",
      {
        id: "session-3",
        state: "CREATED",
        expiresAt: "2026-02-25T00:00:00.000Z"
      },
      50
    );
    await manager.refreshSessionTtl("session-3", 300);

    expect(await redis.ttl("rfq:session-3:meta")).toBe(300);
    expect(await redis.ttl("rfq:session-3:quotes")).toBe(300);
  });

  it("acquires lock using SET NX and rejects duplicate lock acquisition", async () => {
    const redis = new FakeRedisClient();
    const manager = new RFQSessionManager({ redis, lockTtlMs: 1000 });

    const first = await manager.acquireLock("session-4", "owner-a");
    const second = await manager.acquireLock("session-4", "owner-b");

    expect(first).toBe(true);
    expect(second).toBe(false);

    await manager.releaseLock("session-4");
    const third = await manager.acquireLock("session-4", "owner-c");
    expect(third).toBe(true);
  });

  it("emits expiration event when meta key expiration is observed", async () => {
    const redis = new FakeRedisClient();
    const hook = vi.fn<(event: SessionExpiredEvent) => void>();
    const manager = new RFQSessionManager({
      redis,
      onSessionExpired: hook,
      now: () => new Date("2026-02-25T12:00:00.000Z")
    });

    const emitted: SessionExpiredEvent[] = [];
    manager.on("sessionExpired", (event: SessionExpiredEvent) => {
      emitted.push(event);
    });

    await manager.startExpirationListener();
    redis.emit("pmessage", "__keyevent@*__:expired", "__keyevent@0__:expired", "rfq:s5:meta");

    expect(hook).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      sessionId: "s5",
      expiredKey: "rfq:s5:meta"
    });

    await manager.stopExpirationListener();
  });
});

