import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import pino from "pino";
import { RiskReconciliationJob } from "../../src/jobs/reconcile-exposure.job.js";
import { ExposureRepository } from "../../src/repositories/exposure.repository.js";
import { ExposureRedisCache } from "../../src/repositories/exposure-redis-cache.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { randomUUID } from "node:crypto";
import { deleteRedisKeysByPrefix } from "../helpers/redis-test-utils.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

describe.skipIf(!ENV_READY)("Risk Reconciliation Integration Tests", () => {
    let pool: Pool;
    let redis: any;
    let exposureRepo: ExposureRepository;
    let exposureCache: ExposureRedisCache;
    const readRollingWithRetry = async (
        userId: string,
        marketId: string,
        expected: number
    ): Promise<number> => {
        for (let attempt = 0; attempt < 6; attempt++) {
            const currentValue = await exposureCache.getRollingExposure(userId, marketId);
            if (Math.abs(currentValue - expected) < 0.0001) {
                return currentValue;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return exposureCache.getRollingExposure(userId, marketId);
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL! });
        redis = createRedisClient({ redisUrl: TEST_REDIS_URL!, logger });
        await connectRedis(redis);

        exposureRepo = new ExposureRepository(pool, logger);
        exposureCache = new ExposureRedisCache(redis);

        // Ensure reconcile log table exists (in case migration didn't run in test env)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS risk_reconcile_log (
                id BIGSERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                canonical_market_id UUID NOT NULL,
                side TEXT NOT NULL,
                postgres_value NUMERIC NOT NULL,
                redis_value NUMERIC NOT NULL,
                diff NUMERIC NOT NULL,
                fixed BOOLEAN NOT NULL DEFAULT false,
                occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await pool.end();
        }
        if (redis) {
            await disconnectRedis(redis);
        }
    }, 60000);

    beforeEach(async () => {
        await pool.query("TRUNCATE TABLE exposure, exposure_journal, risk_reconcile_log CASCADE");
        await deleteRedisKeysByPrefix(redis, ["risk:rolling:user:", "risk:lock:exec:"]);
    });

    it("detects and logs mismatches", async () => {
        const userId = randomUUID();
        const marketId = randomUUID();

        // Setup state: Postgres has 1000, Redis has 500
        const client = await pool.connect();
        try {
            await exposureRepo.createExposure(userId, marketId, "buy", 1000, 1000, client);
        } finally {
            client.release();
        }
        await exposureCache.setRollingExposure(userId, marketId, 500, 3600000);
        const seededRolling = await readRollingWithRetry(userId, marketId, 500);
        expect(seededRolling).toBe(500);

        const job = new RiskReconciliationJob(pool, redis, logger, false); // No auto-fix
        const result = await job.run({ batchSize: 10, fullReconcile: true });

        expect(result.mismatches).toBeGreaterThanOrEqual(1);

        const logs = await pool.query(
            "SELECT * FROM risk_reconcile_log WHERE user_id = $1 AND canonical_market_id = $2",
            [userId, marketId]
        );
        expect(logs.rows.length).toBeGreaterThanOrEqual(1);
        expect(Number(logs.rows[0].postgres_value)).toBe(1000);
        expect(Number(logs.rows[0].redis_value)).toBe(500);
        expect(logs.rows[0].fixed).toBe(false);
    });

    it("automatically fixes mismatches when enabled", async () => {
        const userId = randomUUID();
        const marketId = randomUUID();

        const client = await pool.connect();
        try {
            await exposureRepo.createExposure(userId, marketId, "buy", 1000, 1000, client);
        } finally {
            client.release();
        }
        await exposureCache.setRollingExposure(userId, marketId, 500, 3600000);
        const seededRolling = await readRollingWithRetry(userId, marketId, 500);
        expect(seededRolling).toBe(500);

        const job = new RiskReconciliationJob(pool, redis, logger, true); // Auto-fix enabled
        await job.run({ batchSize: 10, fullReconcile: true });

        // Verify Redis is fixed
        const fixedRedisValue = await readRollingWithRetry(userId, marketId, 1000);
        expect(fixedRedisValue).toBe(1000);

        // Verify log is marked as fixed
        const logs = await pool.query(
            "SELECT * FROM risk_reconcile_log WHERE user_id = $1 AND canonical_market_id = $2 ORDER BY occurred_at DESC",
            [userId, marketId]
        );
        expect(logs.rows.length).toBeGreaterThanOrEqual(1);
        expect(logs.rows[0].fixed).toBe(true);
    });
});
