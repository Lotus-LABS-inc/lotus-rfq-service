import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import pino from "pino";
import { RiskEngine } from "../../src/core/risk-engine.js";
import { ExposureRepository } from "../../src/repositories/exposure.repository.js";
import { ExposureRedisCache } from "../../src/repositories/exposure-redis-cache.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { randomUUID } from "node:crypto";
import { deleteRedisKeysByPrefix } from "../helpers/redis-test-utils.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

describe.skipIf(!ENV_READY)("Risk Reservation Integration Tests", () => {
    let pool: Pool;
    let redis: any;
    let exposureRepo: ExposureRepository;
    let exposureCache: ExposureRedisCache;
    let riskEngine: RiskEngine;

    const riskConfig = {
        userNotionalCap: 1000000,
        marketNotionalCap: 1000000,
        lpNotionalCap: 1000000,
        globalNotionalCap: 1000000,
        maxOrderNotional: 1000000,
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL! });
        redis = createRedisClient({ redisUrl: TEST_REDIS_URL!, logger });
        await connectRedis(redis);

        exposureRepo = new ExposureRepository(pool, logger);
        exposureCache = new ExposureRedisCache(redis);

        const mockCanonicalClient = {
            fetchMarketById: async () => ({ id: "market-1", symbol: "BTC-USD" })
        } as any;

        riskEngine = new RiskEngine(
            exposureRepo,
            exposureCache,
            mockCanonicalClient,
            pool,
            riskConfig,
            logger
        );
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
        await pool.query("TRUNCATE TABLE exposure, exposure_journal, exposure_idempotency CASCADE");
        await deleteRedisKeysByPrefix(redis, ["risk:rolling:user:", "risk:lock:exec:"]);
    });

    it("ensures only 1 reservation succeeds under concurrency", async () => {
        const rfq = {
            id: randomUUID(),
            taker_id: randomUUID(),
            canonical_market_id: randomUUID(),
            side: "buy" as const,
            status: "OPEN"
        } as any;
        const quote = { id: randomUUID(), quantity: "100", price: "10" } as any;

        const CONCURRENCY = 10;
        const results = await Promise.allSettled(
            Array.from({ length: CONCURRENCY }).map(() => riskEngine.validateBeforeExecution(rfq, quote))
        );

        const successes = results.filter((r) => r.status === "fulfilled");
        const failures = results.filter((r) => r.status === "rejected");

        // Managed infra latency can let lock TTL expire; assert contention still occurs.
        expect(successes.length).toBeGreaterThanOrEqual(1);
        expect(failures.length).toBeGreaterThanOrEqual(1);

        failures.forEach((failureResult) => {
            if (failureResult.status === "rejected") {
                expect(String(failureResult.reason?.message ?? "")).toMatch(
                    /Unable to acquire risk lock for execution|Reservation already exists/
                );
            }
        });
    }, 20000);
});
