import { randomUUID } from "node:crypto";

import type { RedisClient } from "../../db/redis.js";

export class OrderLockError extends Error {
    constructor(public readonly orderIds: string[]) {
        super(`Unable to acquire locks for orders: ${orderIds.join(", ")}`);
        this.name = "OrderLockError";
    }
}

export interface LockHandle {
    lockIds: string[];
    ownerId: string;
}

export class OrderLocker {
    private readonly MAX_RETRIES = 5;
    private readonly BASE_DELAY_MS = 50;
    private readonly LOCK_TTL_MS = 3000;

    constructor(private readonly redis: RedisClient) { }

    /**
     * Acquires locks for two orders deterministically to prevent deadlocks.
     * Lock smaller UUID first.
     */
    async acquireDualOrderLocks(orderIdA: string, orderIdB: string): Promise<LockHandle> {
        const sortedIds = [orderIdA, orderIdB].sort();
        const ownerId = randomUUID();

        let attempt = 0;
        while (attempt < this.MAX_RETRIES) {
            const acquired: string[] = [];
            try {
                for (const id of sortedIds) {
                    const lockKey = `lock:order:${id}`;
                    const ok = await this.redis.set(lockKey, ownerId, "PX", this.LOCK_TTL_MS, "NX");

                    if (ok === "OK") {
                        acquired.push(lockKey);
                    } else {
                        // Failed to acquire this lock, break and retry after releasing held locks
                        throw new Error("RETRY");
                    }
                }

                // Success
                return { lockIds: acquired, ownerId };
            } catch (e) {
                // Release any locks acquired in this attempt
                if (acquired.length > 0) {
                    await this.redis.del(...acquired);
                }

                if (e instanceof Error && e.message === "RETRY") {
                    attempt++;
                    if (attempt >= this.MAX_RETRIES) break;

                    const delay = this.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw e;
            }
        }

        throw new OrderLockError(sortedIds);
    }

    /**
     * Releases acquired locks.
     * Note: In a production environment, we should check the ownerId 
     * to ensure we don't release a lock that has expired and been re-acquired.
     */
    async releaseLocks(handle: LockHandle): Promise<void> {
        const { lockIds, ownerId } = handle;
        if (lockIds.length === 0) return;

        // Use a Lua script or simple loop with owner check for production
        // For now, simple multi-del as requested
        for (const key of lockIds) {
            const currentOwner = await this.redis.get(key);
            if (currentOwner === ownerId) {
                await this.redis.del(key);
            }
        }
    }
}
