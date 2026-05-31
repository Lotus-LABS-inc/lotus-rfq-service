import { createHash } from "node:crypto";
import type { RedisClient } from "../db/redis.js";

export interface MarketCatalogSnapshotCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

export class RedisMarketCatalogSnapshotCache implements MarketCatalogSnapshotCache {
  public constructor(
    private readonly redis: Pick<RedisClient, "get" | "set">,
    private readonly options: {
      keyPrefix?: string | undefined;
      version?: string | undefined;
    } = {}
  ) {}

  public async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.keyFor(key));
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { value?: unknown };
      return parsed.value as T;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const safeTtlMs = Math.max(1_000, Math.floor(ttlMs));
    const payload = JSON.stringify({
      version: this.options.version ?? "v1",
      cachedAt: new Date().toISOString(),
      value
    });
    await this.redis.set(this.keyFor(key), payload, "PX", safeTtlMs);
  }

  private keyFor(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return `${this.options.keyPrefix ?? "lotus:market-catalog-snapshot"}:${this.options.version ?? "v1"}:${digest}`;
  }
}
