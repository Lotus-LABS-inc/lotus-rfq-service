import { beforeEach, describe, expect, it } from "vitest";

import { Phase2BCandidateRegistry } from "../../src/core/combo-engine/phase2b-candidate-registry.js";
import type { ResidualVector } from "../../src/core/combo-engine/types.js";

interface StoredZSetEntry {
  member: string;
  score: number;
}

class InMemoryPhase2BRedisClient {
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, StoredZSetEntry[]>();

  public async set(key: string, value: string): Promise<"OK" | null> {
    this.strings.set(key, value);
    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  public async zadd(key: string, score: number, member: string): Promise<number> {
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

  public async zrem(key: string, member: string): Promise<number> {
    const entries = this.zsets.get(key) ?? [];
    const filtered = entries.filter((entry) => entry.member !== member);
    if (filtered.length === 0) {
      this.zsets.delete(key);
    } else {
      this.zsets.set(key, filtered);
    }
    return filtered.length === entries.length ? 0 : 1;
  }

  public async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const entries = this.zsets.get(key) ?? [];
    return entries.slice(start, stop + 1).map((entry) => entry.member);
  }

  public setRawString(key: string, value: string): void {
    this.strings.set(key, value);
  }
}

const makeVector = (overrides: Partial<ResidualVector> = {}): ResidualVector => ({
  entityId: overrides.entityId ?? "entity-1",
  userId: overrides.userId ?? "user-1",
  compatibilityBucket: overrides.compatibilityBucket ?? "bucket-a",
  vector: overrides.vector ?? { "market-1:outcome-yes": "5" },
  legCount: overrides.legCount ?? 1,
  grossAbsSize: overrides.grossAbsSize ?? "5"
});

describe("Phase2BCandidateRegistry", () => {
  let redis: InMemoryPhase2BRedisClient;
  let registry: Phase2BCandidateRegistry;

  beforeEach(() => {
    redis = new InMemoryPhase2BRedisClient();
    registry = new Phase2BCandidateRegistry(redis);
  });

  it("registers entity snapshots and bucket membership", async () => {
    const snapshot = await registry.registerEntity(makeVector());

    expect(snapshot.entityId).toBe("entity-1");
    expect(snapshot.compatibilityBucket).toBe("bucket-a");
    expect(snapshot.registeredAt).toBeTypeOf("string");

    await expect(registry.getEntitySnapshot("entity-1")).resolves.toMatchObject({
      entityId: "entity-1",
      compatibilityBucket: "bucket-a"
    });
    await expect(registry.listBucketEntities("bucket-a", 10)).resolves.toMatchObject({
      entityIds: ["entity-1"]
    });
  });

  it("unregisters snapshot and bucket membership", async () => {
    await registry.registerEntity(makeVector());

    const result = await registry.unregisterEntity("entity-1", "bucket-a");

    expect(result).toEqual({
      entityId: "entity-1",
      bucketId: "bucket-a",
      removed: true
    });
    await expect(registry.getEntitySnapshot("entity-1")).resolves.toBeNull();
    await expect(registry.listBucketEntities("bucket-a", 10)).resolves.toEqual({
      entityIds: [],
      nextCursor: null
    });
  });

  it("returns parsed entity snapshots", async () => {
    await registry.registerEntity(makeVector());

    const snapshot = await registry.getEntitySnapshot("entity-1");

    expect(snapshot).toMatchObject({
      entityId: "entity-1",
      userId: "user-1",
      vector: { "market-1:outcome-yes": "5" }
    });
  });

  it("fails closed on malformed snapshots", async () => {
    redis.setRawString("clearing:entity:entity-bad", "{not-json");

    await expect(registry.getEntitySnapshot("entity-bad")).rejects.toThrow("malformed_entity_snapshot");
  });

  it("returns bounded bucket windows with cursor pagination", async () => {
    await registry.registerEntity(makeVector({ entityId: "entity-1" }));
    await registry.registerEntity(makeVector({ entityId: "entity-2" }));
    await registry.registerEntity(makeVector({ entityId: "entity-3" }));

    const firstPage = await registry.listBucketEntities("bucket-a", 2);
    const secondPage = await registry.listBucketEntities("bucket-a", 2, firstPage.nextCursor ?? undefined);

    expect(firstPage.entityIds).toEqual(["entity-1", "entity-2"]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.entityIds).toEqual(["entity-3"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("keeps duplicate registration idempotent on bucket membership while refreshing the snapshot", async () => {
    const first = await registry.registerEntity(makeVector({ grossAbsSize: "5" }));
    const second = await registry.registerEntity(makeVector({ grossAbsSize: "7" }));

    expect(first.entityId).toBe("entity-1");
    expect(second.entityId).toBe("entity-1");
    await expect(registry.listBucketEntities("bucket-a", 10)).resolves.toMatchObject({
      entityIds: ["entity-1"]
    });
    await expect(registry.getEntitySnapshot("entity-1")).resolves.toMatchObject({
      grossAbsSize: "7"
    });
  });

  it("keeps different buckets isolated", async () => {
    await registry.registerEntity(makeVector({ entityId: "entity-a", compatibilityBucket: "bucket-a" }));
    await registry.registerEntity(makeVector({ entityId: "entity-b", compatibilityBucket: "bucket-b" }));

    await expect(registry.listBucketEntities("bucket-a", 10)).resolves.toEqual({
      entityIds: ["entity-a"],
      nextCursor: null
    });
    await expect(registry.listBucketEntities("bucket-b", 10)).resolves.toEqual({
      entityIds: ["entity-b"],
      nextCursor: null
    });
  });

  it("returns null for missing snapshots", async () => {
    await expect(registry.getEntitySnapshot("missing")).resolves.toBeNull();
  });
});
