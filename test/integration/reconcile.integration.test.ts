import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import pino from "pino";
import { RiskReconciliationJob } from "../../src/jobs/reconcile-exposure.job.ts";
import { ExposureRepository } from "../../src/repositories/exposure.repository.ts";
import { ExposureRedisCache } from "../../src/repositories/exposure-redis-cache.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { randomUUID } from "node:crypto";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379";
const logger = pino({ level: "silent" });

describe("Risk Reconciliation Integration Tests", () => {
    let pool: Pool;
    let redis: any;
    let exposureRepo: ExposureRepository;
    let exposureCache: ExposureRedisCache;

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
    });

    afterAll(async () => {
        await pool.end();
        await disconnectRedis(redis);
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE TABLE exposure, exposure_journal, risk_reconcile_log CASCADE");
        await redis.flushdb();
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

        const job = new RiskReconciliationJob(pool, redis, logger, false); // No auto-fix
        const result = await job.run({ batchSize: 10, fullReconcile: true });

        expect(result.mismatches).toBe(1);

        const logs = await pool.query("SELECT * FROM risk_reconcile_log");
        expect(logs.rows.length).toBe(1);
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

        const job = new RiskReconciliationJob(pool, redis, logger, true); // Auto-fix enabled
        await job.run({ batchSize: 10, fullReconcile: true });

        // Verify Redis is fixed
        const fixedRedisValue = await exposureCache.getRollingExposure(userId, marketId);
        expect(fixedRedisValue).toBe(1000);

        // Verify log is marked as fixed
        const logs = await pool.query("SELECT * FROM risk_reconcile_log");
        expect(logs.rows[0].fixed).toBe(true);
    });
});
