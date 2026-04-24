import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { RiskEngine } from "../../src/core/risk-engine.js";
import { ExposureRepository } from "../../src/repositories/exposure.repository.js";
import { ExposureRedisCache } from "../../src/repositories/exposure-redis-cache.js";
import { createRedisClient, connectRedis, disconnectRedis } from "../../src/db/redis.js";
import { loadEnv } from "../../src/utils/env.js";
import { existsSync } from "node:fs";

// Load .env if it exists
if (existsSync(".env")) {
    process.loadEnvFile(".env");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runStressTest() {
    const env = loadEnv();
    const logger = pino({ level: "info" });
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });
    await connectRedis(redis);

    const exposureRepo = new ExposureRepository(pool, logger);
    const exposureCache = new ExposureRedisCache(redis);

    // Mock Canonical Client
    const mockCanonicalClient = {
        fetchMarketById: async () => ({ id: "market-1", symbol: "BTC-USD" })
    } as any;

    const riskConfig = {
        userNotionalCap: 1000000,
        marketNotionalCap: 1000000,
        lpNotionalCap: 1000000,
        globalNotionalCap: 1000000,
        maxOrderNotional: 1000000,
    };

    const riskEngine = new RiskEngine(
        exposureRepo,
        exposureCache,
        mockCanonicalClient,
        pool,
        riskConfig,
        logger
    );

    const TEST_TAG = `stress:${Date.now()}`;
    const takerId = randomUUID();
    const marketId = randomUUID();
    const rfqId = randomUUID();

    const stressRfqId = randomUUID();
    console.log(`Starting Stress Test Phase: Taker=${takerId}, RFQ=${stressRfqId}`);

    pool.on("error", (err) => {
        console.error("UNEXPECTED POOL ERROR:", err.message);
    });

    // Serial check to verify environment
    console.log("Running serial verification...");
    try {
        const quote = { id: randomUUID(), quantity: "10", price: "10" } as any;
        const rfq = { id: rfqId, taker_id: takerId, canonical_market_id: marketId, side: "buy" } as any;
        await riskEngine.validateBeforeExecution(rfq, quote);
        console.log("Serial verification SUCCESS");
        // Clear lock for stress test
        await redis.del(`risk:lock:exec:${rfqId}`);
    } catch (err: any) {
        console.error("Serial verification FAILED:", err.message);
        process.exit(1);
    }

    let successes = 0;
    let failures = 0;
    let maxLockWait = 0;

    // 1. Concurrent Reservations (100)
    const reservations = Array.from({ length: 100 }).map(async (_, i) => {
        const start = Date.now();
        await sleep(Math.random() * 500); // Increased spread to allow retries to breathe
        try {
            const quote = { id: randomUUID(), quantity: (10 + Math.random() * 10).toString(), price: "10" } as any;
            const rfq = { id: stressRfqId, taker_id: takerId, canonical_market_id: marketId, side: "buy" } as any;
            await riskEngine.validateBeforeExecution(rfq, quote);
            successes++;
        } catch (err: any) {
            failures++;
            if (failures <= 5) {
                console.log(`Reservation failure ${failures}: ${err.message}`);
                // if (err.stack) console.log(err.stack);
            }
        } finally {
            maxLockWait = Math.max(maxLockWait, Date.now() - start);
        }
    });

    await Promise.all(reservations);

    console.log(`Reservations finished. Successes: ${successes}, Failures: ${failures}`);

    if (successes !== 1) {
        console.error(`CRITICAL FAILURE: Expected exactly 1 reservation success, but got ${successes}`);
        process.exit(1);
    }

    // 2. Idempotent Updates (100 duplicates)
    console.log("Starting idempotent update simulation...");
    const executionId = randomUUID();
    const execBase = {
        id: executionId,
        sessionId: stressRfqId,
        takerId: takerId,
        canonicalMarketId: marketId,
        side: "buy" as const,
        executedQuantity: "100",
        executedPrice: "10"
    };

    let updatesAttempted = 0;
    const updates = Array.from({ length: 100 }).map(async () => {
        await sleep(Math.random() * 50);
        await riskEngine.updateExposureAfterExecution(execBase);
        updatesAttempted++;
    });

    await Promise.all(updates);

    // 3. Integrity Check
    const exposure = await exposureRepo.getExposure(takerId, marketId, "buy");
    const rolling = await exposureCache.getRollingExposure(takerId, marketId);

    console.log(`Integrity Check: Postgres=${exposure?.gross_notional}, Redis=${rolling}`);

    if (!exposure || Number.parseFloat(exposure.gross_notional) !== 1000) {
        console.error(`CRITICAL FAILURE: Postgres exposure inconsistent. Expected 1000, got ${exposure?.gross_notional}`);
        process.exit(1);
    }

    if (rolling !== 1000) {
        console.error(`CRITICAL FAILURE: Redis rolling exposure inconsistent. Expected 1000, got ${rolling}`);
        process.exit(1);
    }

    const journalCountRes = await pool.query(
        "SELECT count(*) FROM exposure_journal WHERE reference_id = $1 AND source = 'rfq-execution'",
        [executionId]
    );
    const journalCount = Number.parseInt(journalCountRes.rows[0].count);

    if (journalCount !== 1) {
        console.error(`CRITICAL FAILURE: Double application detected! Execution journal has ${journalCount} entries.`);
        process.exit(1);
    }

    console.log("STRESS TEST PASSED SUCCESSFULLY");
    console.log(`Summary:
    - Successful Reservations: ${successes}
    - Rejected Reservations: ${failures}
    - Idempotent Replays Prevented: ${updatesAttempted - 1}
    - Max Lock Wait Cycle: ${maxLockWait}ms
    - Exposure Integrity: OK`);

    await pool.end();
    await disconnectRedis(redis);
    process.exit(0);
}

runStressTest().catch((err) => {
    console.error("Stress test failed with error:", err);
    process.exit(1);
});
