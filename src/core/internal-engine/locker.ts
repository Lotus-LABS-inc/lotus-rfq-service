import { randomUUID } from "node:crypto";

import type { RedisClient } from "../../db/redis.js";

export class OrderLockError extends Error {
    constructor(
        public readonly orderIds: readonly string[],
        public readonly attempts: number
    ) {
        super(`Unable to acquire locks for orders after ${attempts} attempts: ${orderIds.join(", ")}`);
        this.name = "OrderLockError";
    }
}

export interface LockHandle {
    lockIds: readonly string[];
    ownerId: string;
}

export interface OrderLockerOptions {
    maxRetries?: number;
    baseDelayMs?: number;
    lockTtlMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

export class OrderLocker {
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly lockTtlMs: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(
        private readonly redis: RedisClient,
        options: OrderLockerOptions = {}
    ) {
        this.maxRetries = options.maxRetries ?? 5;
        this.baseDelayMs = options.baseDelayMs ?? 50;
        this.lockTtlMs = options.lockTtlMs ?? 3000;
        this.sleep = options.sleep ?? this.defaultSleep;
    }

    /**
     * Acquires locks for two orders deterministically to prevent deadlocks.
     * Lock smaller UUID first.
     */
    async acquireDualOrderLocks(orderIdA: string, orderIdB: string): Promise<LockHandle> {
        const sortedIds = this.sortAndDedupeOrderIds(orderIdA, orderIdB);
        const ownerId = randomUUID();

        for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
            const acquired = await this.tryAcquireLocks(sortedIds, ownerId);
            if (acquired !== null) {
                return {
                    lockIds: acquired,
                    ownerId
                };
            }

            if (attempt < this.maxRetries) {
                await this.sleep(this.baseDelayMs * Math.pow(2, attempt - 1));
            }
        }

        throw new OrderLockError(sortedIds, this.maxRetries);
    }

    /**
     * Releases acquired locks with owner validation so we do not delete a lock
     * that expired and was subsequently acquired by another worker.
     */
    async releaseLocks(handle: LockHandle): Promise<void> {
        const { lockIds, ownerId } = handle;
        if (lockIds.length === 0) {
            return;
        }

        for (const key of lockIds) {
            const currentOwner = await this.redis.get(key);
            if (currentOwner === ownerId) {
                await this.redis.del(key);
            }
        }
    }

    private async tryAcquireLocks(orderIds: readonly string[], ownerId: string): Promise<readonly string[] | null> {
        const acquiredKeys: string[] = [];

        for (const orderId of orderIds) {
            const lockKey = this.lockKey(orderId);
            const outcome = await this.redis.set(lockKey, ownerId, "PX", this.lockTtlMs, "NX");
            if (outcome !== "OK") {
                await this.releaseLocks({
                    lockIds: acquiredKeys,
                    ownerId
                });
                return null;
            }

            acquiredKeys.push(lockKey);
        }

        return acquiredKeys;
    }

    private sortAndDedupeOrderIds(orderIdA: string, orderIdB: string): readonly string[] {
        return Array.from(new Set([orderIdA, orderIdB])).sort((left, right) => left.localeCompare(right));
    }

    private lockKey(orderId: string): string {
        return `lock:order:${orderId}`;
    }

    private async defaultSleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
