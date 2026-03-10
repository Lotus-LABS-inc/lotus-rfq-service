import { randomUUID } from "node:crypto";

import type { RedisClient } from "../../db/redis.js";

export class ResourceLockError extends Error {
  public constructor(
    public readonly resourceIds: readonly string[],
    public readonly attempts: number
  ) {
    super(`Unable to acquire locks after ${attempts} attempts: ${resourceIds.join(", ")}`);
    this.name = "ResourceLockError";
  }
}

export interface ResourceLockHandle {
  lockKeys: readonly string[];
  ownerId: string;
}

export interface ResourceLockerOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  lockTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class ResourceLocker {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly lockTtlMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(
    private readonly redis: RedisClient,
    options: ResourceLockerOptions = {}
  ) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 50;
    this.lockTtlMs = options.lockTtlMs ?? 3000;
    this.sleep = options.sleep ?? this.defaultSleep;
  }

  public async acquireLocks(resourceIds: readonly string[]): Promise<ResourceLockHandle> {
    const sortedResourceIds = [...new Set(resourceIds)].sort((left, right) => left.localeCompare(right));
    const ownerId = randomUUID();

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const acquired = await this.tryAcquireLocks(sortedResourceIds, ownerId);
      if (acquired !== null) {
        return {
          lockKeys: acquired,
          ownerId
        };
      }

      if (attempt < this.maxRetries) {
        await this.sleep(this.baseDelayMs * Math.pow(2, attempt - 1));
      }
    }

    throw new ResourceLockError(sortedResourceIds, this.maxRetries);
  }

  public async releaseLocks(handle: ResourceLockHandle): Promise<void> {
    for (const key of handle.lockKeys) {
      const currentOwner = await this.redis.get(key);
      if (currentOwner === handle.ownerId) {
        await this.redis.del(key);
      }
    }
  }

  public comboLockId(comboId: string): string {
    return `lock:combo:${comboId}`;
  }

  public comboLegLockId(legId: string): string {
    return `lock:combo-leg:${legId}`;
  }

  private async tryAcquireLocks(
    resourceIds: readonly string[],
    ownerId: string
  ): Promise<readonly string[] | null> {
    const acquiredKeys: string[] = [];

    for (const resourceId of resourceIds) {
      const result = await this.redis.set(resourceId, ownerId, "PX", this.lockTtlMs, "NX");
      if (result !== "OK") {
        await this.releaseLocks({ lockKeys: acquiredKeys, ownerId });
        return null;
      }

      acquiredKeys.push(resourceId);
    }

    return acquiredKeys;
  }

  private async defaultSleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
