import type { RedisClient } from "../db/redis.js";
import { riskInternalErrorTotal } from "../observability/metrics.js";

export class ExposureRedisCache {
    public constructor(private readonly redis: RedisClient) { }

    public async getRollingExposure(userId: string, marketId: string): Promise<number> {
        try {
            const val = await this.redis.get(`risk:rolling:user:${userId}:market:${marketId}`);
            return val ? Number.parseFloat(val) : 0;
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "get_rolling_exposure" });
            throw error;
        }
    }

    public async incRollingExposure(userId: string, marketId: string, delta: number, ttlMs: number): Promise<void> {
        const key = `risk:rolling:user:${userId}:market:${marketId}`;
        try {
            /**
             * Atomic increment and expire if it's a new key.
             * ARGV[1] = deltaValue
             * ARGV[2] = ttlMs
             */
            await this.redis.eval(
                `local current = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
         if tonumber(redis.call('PTTL', KEYS[1])) < 0 then
           redis.call('PEXPIRE', KEYS[1], ARGV[2])
         end
         return current`,
                1,
                key,
                delta.toString(),
                ttlMs.toString()
            );
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "inc_rolling_exposure" });
            throw error;
        }
    }

    public async lockExposureKey(lockKey: string, ttlMs: number): Promise<string | null> {
        const token = Math.random().toString(36).substring(2);
        try {
            const result = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");
            return result === "OK" ? token : null;
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "lock_exposure_key" });
            return null;
        }
    }

    public async unlockExposureKey(lockKey: string, token: string): Promise<void> {
        try {
            /**
             * Safe unlock ensures only the legitimate token holder can release the lock.
             */
            await this.redis.eval(
                `if redis.call("get", KEYS[1]) == ARGV[1] then
           return redis.call("del", KEYS[1])
         else
           return 0
         end`,
                1,
                lockKey,
                token
            );
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "unlock_exposure_key" });
        }
    }

    public async forceUnlock(lockKey: string): Promise<void> {
        try {
            await this.redis.del(lockKey);
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "force_unlock_exposure_key" });
        }
    }

    public async setRollingExposure(userId: string, marketId: string, value: number, ttlMs: number): Promise<void> {
        const key = `risk:rolling:user:${userId}:market:${marketId}`;
        try {
            await this.redis.set(key, value.toString(), "PX", ttlMs);
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "set_rolling_exposure" });
            throw error;
        }
    }
}
