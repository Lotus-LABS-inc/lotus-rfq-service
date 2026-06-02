import { describe, expect, it } from "vitest";

import {
  RedisMarketCatalogSnapshotCache,
  resolveMarketCatalogSnapshotCacheKeyPrefix
} from "../src/services/market-catalog-snapshot-cache.js";

class FakeRedis {
  public values = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }
}

describe("market catalog snapshot cache", () => {
  it("derives stable deployment-scoped key prefixes", () => {
    expect(resolveMarketCatalogSnapshotCacheKeyPrefix({
      lotusDeployEnv: "production"
    })).toBe("lotus:prod:market-catalog-snapshot");
    expect(resolveMarketCatalogSnapshotCacheKeyPrefix({
      lotusDeployEnv: "staging"
    })).toBe("lotus:staging:market-catalog-snapshot");
    expect(resolveMarketCatalogSnapshotCacheKeyPrefix({
      canonicalServiceBaseUrl: "https://staging-api.uselotus.xyz"
    })).toBe("lotus:staging:market-catalog-snapshot");
  });

  it("does not let prod and staging snapshots collide in shared Redis", async () => {
    const redis = new FakeRedis();
    const prod = new RedisMarketCatalogSnapshotCache(redis, {
      keyPrefix: resolveMarketCatalogSnapshotCacheKeyPrefix({ lotusDeployEnv: "prod" })
    });
    const staging = new RedisMarketCatalogSnapshotCache(redis, {
      keyPrefix: resolveMarketCatalogSnapshotCacheKeyPrefix({ lotusDeployEnv: "staging" })
    });

    await prod.set("markets:{\"limit\":250,\"quoteReadyOnly\":true}", { count: 250, env: "prod" }, 300_000);
    await staging.set("markets:{\"limit\":250,\"quoteReadyOnly\":true}", { count: 15, env: "staging" }, 300_000);

    await expect(prod.get("markets:{\"limit\":250,\"quoteReadyOnly\":true}")).resolves.toEqual({
      count: 250,
      env: "prod"
    });
    await expect(staging.get("markets:{\"limit\":250,\"quoteReadyOnly\":true}")).resolves.toEqual({
      count: 15,
      env: "staging"
    });
    expect(redis.values).toHaveLength(2);
  });
});
