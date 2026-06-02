import { createHash } from "node:crypto";
import type { RedisClient } from "../db/redis.js";

export interface MarketCatalogSnapshotCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

export interface MarketCatalogSnapshotKeyPrefixInput {
  lotusDeployEnv?: string | undefined;
  lotusEnv?: string | undefined;
  appEnv?: string | undefined;
  nodeEnv?: string | undefined;
  canonicalServiceBaseUrl?: string | undefined;
}

export const resolveMarketCatalogSnapshotCacheKeyPrefix = (
  input: MarketCatalogSnapshotKeyPrefixInput = {}
): string => {
  const namespace = [
    input.lotusDeployEnv,
    input.lotusEnv,
    input.appEnv,
    inferNamespaceFromUrl(input.canonicalServiceBaseUrl),
    input.nodeEnv
  ]
    .map(normalizeSnapshotNamespace)
    .find((value): value is string => value !== null) ?? "local";
  return `lotus:${namespace}:market-catalog-snapshot`;
};

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
      version: this.options.version ?? "v2",
      cachedAt: new Date().toISOString(),
      value
    });
    await this.redis.set(this.keyFor(key), payload, "PX", safeTtlMs);
  }

  private keyFor(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return `${this.options.keyPrefix ?? "lotus:market-catalog-snapshot"}:${this.options.version ?? "v2"}:${digest}`;
  }
}

const normalizeSnapshotNamespace = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("staging") || normalized.includes("preview")) {
    return "staging";
  }
  if (normalized.includes("production") || normalized === "prod") {
    return "prod";
  }
  if (normalized === "test") {
    return "test";
  }
  if (normalized === "development" || normalized === "dev") {
    return "dev";
  }
  const sanitized = normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized.slice(0, 32) : null;
};

const inferNamespaceFromUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};
