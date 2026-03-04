import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import pino from "pino";
import { RiskEngine, RiskRejectedError } from "../../src/core/risk-engine.js";
import { ExposureRepository } from "../../src/repositories/exposure.repository.js";
import { ExposureRedisCache } from "../../src/repositories/exposure-redis-cache.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { randomUUID } from "node:crypto";
import { deleteRedisKeysByPrefix } from "../helpers/redis-test-utils.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

describe.skipIf(!ENV_READY)("RiskEngine Unit Tests", () => {
    let pool: Pool;
    let redis: any;
    let exposureRepo: ExposureRepository;
    let exposureCache: ExposureRedisCache;
    let riskEngine: RiskEngine;

    const riskConfig = {
        userNotionalCap: 10000,
        marketNotionalCap: 50000,
        lpNotionalCap: 30000,
        globalNotionalCap: 100000,
        maxOrderNotional: 5000,
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DB_URL! });
        redis = createRedisClient({ redisUrl: TEST_REDIS_URL!, logger });
        await connectRedis(redis);

        exposureRepo = new ExposureRepository(pool, logger);
        exposureCache = new ExposureRedisCache(redis);

        // Mock CanonicalMarketClient
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
    });

    afterAll(async () => {
        if (pool) {
            await pool.end();
        }
        if (redis) {
            await disconnectRedis(redis);
        }
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE TABLE exposure, exposure_journal, exposure_idempotency CASCADE");
        await deleteRedisKeysByPrefix(redis, ["risk:rolling:user:", "risk:lock:exec:"]);
    });

    it("rejects when single order cap exceeded", async () => {
        const rfq = {
            taker_id: randomUUID(),
            canonical_market_id: randomUUID(),
            side: "buy" as const,
            quantity: "10000", // 10000 * 1.0 = 10000 (cap is 5000)
            id: randomUUID()
        };

        await expect(riskEngine.validateRFQCreation(rfq)).rejects.toThrow(RiskRejectedError);
    });

    it("rejects when user cap exceeded", async () => {
        const userId = randomUUID();
        const marketId = randomUUID();

        // Setup existing exposure in DB
        const client = await pool.connect();
        try {
            await exposureRepo.createExposure(userId, marketId, "buy", 8000, 8000, client);
        } finally {
            client.release();
        }

        const rfq = {
            taker_id: userId,
            canonical_market_id: marketId,
            side: "buy" as const,
            quantity: "3000", // 8000 + 3000 = 11000 (cap is 10000)
            id: randomUUID()
        };

        await expect(riskEngine.validateRFQCreation(rfq)).rejects.toThrow(RiskRejectedError);
    });

    it("rejects when market cap exceeded", async () => {
        const user1 = randomUUID();
        const marketId = randomUUID();

        const client = await pool.connect();
        try {
            await exposureRepo.createExposure(user1, marketId, "buy", 48000, 48000, client);
        } finally {
            client.release();
        }

        const rfq = {
            taker_id: randomUUID(),
            canonical_market_id: marketId,
            side: "buy" as const,
            quantity: "3000", // 48000 + 3000 = 51000 (cap is 50000)
            id: randomUUID()
        };

        await expect(riskEngine.validateRFQCreation(rfq)).rejects.toThrow(RiskRejectedError);
    });

    it("allows valid RFQ", async () => {
        const rfq = {
            taker_id: randomUUID(),
            canonical_market_id: randomUUID(),
            side: "buy" as const,
            quantity: "1000", // 1000 (cap is 5000)
            id: randomUUID()
        };

        await expect(riskEngine.validateRFQCreation(rfq)).resolves.not.toThrow();
    });

    it("updates exposure after execution idempotently", async () => {
        const exec = {
            id: randomUUID(),
            sessionId: randomUUID(),
            takerId: randomUUID(),
            canonicalMarketId: randomUUID(),
            side: "buy" as const,
            executedQuantity: "100",
            executedPrice: "10"
        };

        // First update
        await riskEngine.updateExposureAfterExecution(exec);

        const exposure = await exposureRepo.getExposure(exec.takerId, exec.canonicalMarketId, "buy");
        expect(exposure).not.toBeNull();
        expect(exposure?.gross_notional).toBe("1000");

        // Second update (idempotent)
        await riskEngine.updateExposureAfterExecution(exec);

        const exposureAgain = await exposureRepo.getExposure(exec.takerId, exec.canonicalMarketId, "buy");
        expect(exposureAgain).not.toBeNull();
        expect(exposureAgain?.gross_notional).toBe("1000"); // No change
    });

    it("handles lock timeout behavior", async () => {
        const sessionId = randomUUID();
        const lockSpy = vi
            .spyOn(exposureCache, "lockExposureKey")
            .mockResolvedValue(null);

        const rfq = { id: sessionId, taker_id: randomUUID(), canonical_market_id: randomUUID() } as any;
        const quote = { id: randomUUID(), quantity: "100", price: "10" } as any;

        // Should fail to acquire lock
        await expect(riskEngine.validateBeforeExecution(rfq, quote)).rejects.toThrow("Unable to acquire risk lock for execution");

        lockSpy.mockRestore();
    });
});
