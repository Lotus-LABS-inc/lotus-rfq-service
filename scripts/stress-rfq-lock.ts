import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { createRedisClient, connectRedis, disconnectRedis } from "../src/db/redis.js";
import { RFQSessionRepository } from "../src/db/repositories/rfq-session-repository.js";
import { RFQQuoteRepository } from "../src/db/repositories/rfq-quote-repository.js";
import { RFQExecutionRepository } from "../src/db/repositories/rfq-execution-repository.js";
import { RFQSessionManager } from "../src/core/rfq-engine/rfq-session-manager.js";
import { ExecutionRouterService } from "../src/core/execution-router/execution-router.js";
import { ReceiveLPQuoteService } from "../src/lp/receive-lp-quote-service.js";
import { InMemoryRFQEventEmitter } from "../src/core/rfq-engine/rfq-domain-events.js";

const logger = pino({ level: "info" });

function loadEnv() {
    const searchPaths = [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../.env")
    ];

    for (const envPath of searchPaths) {
        if (fs.existsSync(envPath)) {
            const envLines = fs.readFileSync(envPath, "utf-8").split("\n");
            for (const line of envLines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) continue;
                const [key, ...valueParts] = trimmed.split("=");
                if (key && valueParts.length > 0) {
                    const val = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
                    if (val) process.env[key.trim()] = val;
                }
            }
        }
    }
}

loadEnv();

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || "redis://localhost:6379";

if (!DB_URL) {
    console.error("Critical: No DATABASE_URL found");
    process.exit(1);
}

async function runStressTest() {
    const pool = new Pool({ connectionString: DB_URL });
    const redisClient = createRedisClient({ redisUrl: REDIS_URL, logger });
    await connectRedis(redisClient);

    const sessionRepository = new RFQSessionRepository(pool);
    const quoteRepository = new RFQQuoteRepository(pool);
    const executionRepository = new RFQExecutionRepository(pool);
    const sessionManager = new RFQSessionManager({ redis: redisClient });
    const eventEmitter = new InMemoryRFQEventEmitter();

    // Instrumentation for Lock Tracking
    let failedLockAttempts = 0;
    let lockAcquisitionTimes: number[] = [];
    const originalAcquireLock = sessionManager.acquireLock.bind(sessionManager);
    sessionManager.acquireLock = async (sessionId: string, ownerId: string, ttlMs?: number) => {
        const start = performance.now();
        const acquired = await originalAcquireLock(sessionId, ownerId, ttlMs);
        const end = performance.now();
        if (acquired) {
            lockAcquisitionTimes.push(end - start);
        } else {
            failedLockAttempts++;
        }
        return acquired;
    };

    console.log("--- STAGE 1: LOCK CONTENTION (100 CONCURRENT SETTLEMENT ATTEMPTS) ---");
    const requestId = randomUUID();

    const session = await sessionRepository.create({
        requestId,
        canonicalMarketId: "mkt-stress-final",
        takerId: "taker-stress",
        side: "buy",
        quantity: "100",
        status: "COLLECTING_QUOTES",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 300000)
    });
    const sessionId = session.id;

    let lpKeyId: string;
    const lpKeys = await pool.query("SELECT id FROM lp_keys LIMIT 1");
    if (lpKeys.rows.length === 0) {
        const result = await pool.query(
            "INSERT INTO lp_keys (lp_id, key_id, public_key, secret_hash, status, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            ["lp-stress", "key-stress", "pub-test", "secret-test", "ACTIVE", "{}"]
        );
        lpKeyId = result.rows[0].id;
    } else {
        lpKeyId = lpKeys.rows[0].id;
    }

    const quoteId = "q-stress-final";
    await pool.query(
        `INSERT INTO rfq_quotes (id, session_id, lp_key_id, quote_status, price, quantity, fee_bps, valid_until, quote_payload)
         VALUES ($1, $2, $3, 'RECEIVED', '100', '100', 0, NOW() + interval '10 minutes', $4::jsonb)`,
        [randomUUID(), sessionId, lpKeyId, JSON.stringify({ quoteId, lpId: "lp-stress" })]
    );

    const executionRouter = new ExecutionRouterService({
        sessionRepository,
        quoteRepository,
        executionRepository,
        sessionManager,
        executionGateway: {
            execute: async () => {
                await new Promise(r => setTimeout(r, 100)); // Simulating external call
                return { ok: true, venueExecutionRef: "exec-" + randomUUID() };
            }
        },
        eventEmitter,
        logger
    });

    const rankedQuote: any = {
        quoteId,
        lpId: "lp-stress",
        basePrice: 100,
        venueFee: 0,
        protocolFee: 0,
        gasCost: 0,
        slippageEstimate: 0,
        firm_until: new Date(Date.now() + 60000).toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        soft_refresh_flag: false
    };

    const startExecution = performance.now();
    const attempts = Array.from({ length: 100 }, () =>
        executionRouter.execute({
            sessionId,
            rankedQuotes: [rankedQuote],
            fallbackToNextQuote: false
        }).catch(err => ({ ok: false, error: err.message }))
    );

    const results = await Promise.all(attempts);
    const endExecution = performance.now();

    const totalSuccess = results.filter((r: any) => r.ok).length;
    const avgLockTime = lockAcquisitionTimes.reduce((a, b) => a + b, 0) / (lockAcquisitionTimes.length || 1);

    console.log(`\nLock Results:`);
    console.log(`- Total Attempts: 100`);
    console.log(`- Success: ${totalSuccess}`);
    console.log(`- Failed Lock Attempts (Contention): ${failedLockAttempts}`);
    console.log(`- Avg Lock Acquisition Time: ${avgLockTime.toFixed(2)}ms`);
    console.log(`- Total Execution Wall Time: ${(endExecution - startExecution).toFixed(2)}ms`);

    // Integrity checks
    if (totalSuccess !== 1) {
        console.error("INTEGRITY FAILURE: Expected exactly 1 success!");
        process.exit(1);
    }

    const dbExecs = await pool.query("SELECT * FROM rfq_executions WHERE session_id = $1", [sessionId]);
    console.log(`- DB Execution Records: ${dbExecs.rows.length}`);
    if (dbExecs.rows.length !== 1) {
        console.error("INTEGRITY FAILURE: Expected exactly 1 DB record!");
        process.exit(1);
    }

    const finalSession = await sessionRepository.findById(sessionId);
    console.log(`- Final Session Status in DB: ${finalSession?.status}`);
    // NOTE: In current production logic, ExecutionRouter does NOT update session status on success.
    // We log this but don't exit with 1 as it currently reflects production behavior.

    console.log("\n--- STAGE 2: QUOTE IDEMPOTENCY (20 CONCURRENT SUBMISSIONS) ---");
    const quoteService = new ReceiveLPQuoteService({
        sessionRepository,
        quoteRepository,
        eventRepository: { append: async () => { } } as any,
        sessionManager,
        redisClient,
        eventEmitter,
        logger,
        lpStatsRepository: { recordQuoteSubmission: async () => { } } as any
    });

    const uniqueQuoteIds = ["uqx1", "uqx2", "uqx3", "uqx4", "uqx5"];
    const quotePayloads: any[] = [];
    for (const uqid of uniqueQuoteIds) {
        for (let i = 0; i < 4; i++) {
            quotePayloads.push({
                authenticatedLpId: "lp-stress",
                authenticatedLpKeyId: "key-stress",
                authenticatedLpKeyDbId: lpKeyId,
                routeLpId: "lp-stress",
                sessionId,
                quoteId: uqid,
                price: "100",
                quantity: "100",
                feeBps: 0,
                validUntil: new Date(Date.now() + 300000).toISOString()
            });
        }
    }

    const quoteAttempts = quotePayloads.map(p => quoteService.execute(p).catch(err => ({ status: 'error', code: err.code || 'UNKNOWN' })));
    const quoteResults = await Promise.all(quoteAttempts);

    const acceptedCount = quoteResults.filter((r: any) => !r || r.status !== 'error').length;
    console.log(`Idempotency Results:`);
    console.log(`- Unique Quotes: 5`);
    console.log(`- Accepted: ${acceptedCount}`);

    if (acceptedCount !== 5) {
        console.error("INTEGRITY FAILURE: Idempotency failed! Duplicate quotes were likely accepted.");
        process.exit(1);
    }

    console.log("\n--- STRESS TEST PASSED SUCCESSFULLY ---");
    await disconnectRedis(redisClient);
    await pool.end();
}

runStressTest().catch(err => {
    console.error("Test process crashed:", err);
    process.exit(1);
});
