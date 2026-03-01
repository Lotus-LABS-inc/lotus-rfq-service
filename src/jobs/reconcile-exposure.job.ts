import { Pool } from "pg";
import type { Logger } from "pino";
import { ExposureRepository } from "../repositories/exposure.repository.js";
import { ExposureRedisCache } from "../repositories/exposure-redis-cache.js";
import { riskReconcileMismatchesTotal } from "../observability/metrics.js";
import { createPgPool } from "../db/postgres.js";
import { createRedisClient, connectRedis, type RedisClient } from "../db/redis.js";
import { loadEnv } from "../utils/env.js";
import { createLogger } from "../utils/logger.js";

export class RiskReconciliationJob {
    private readonly exposureRepo: ExposureRepository;
    private readonly exposureCache: ExposureRedisCache;

    constructor(
        private readonly pgPool: Pool,
        private readonly redis: RedisClient,
        private readonly logger: Logger,
        private readonly autoFix: boolean = false
    ) {
        this.exposureRepo = new ExposureRepository(pgPool, logger);
        this.exposureCache = new ExposureRedisCache(redis);
    }

    public async run(options: { batchSize: number; fullReconcile: boolean }): Promise<{ mismatches: number }> {
        this.logger.info(options, "Starting risk reconciliation job.");
        let totalMismatches = 0;
        let offset = 0;

        while (true) {
            const rows = await this.exposureRepo.listAllExposures(options.batchSize, offset);
            if (rows.length === 0) break;

            for (const row of rows) {
                const redisValue = await this.exposureCache.getRollingExposure(row.user_id, row.canonical_market_id);
                const postgresValue = Number.parseFloat(row.gross_notional); // Using gross_notional as the primary rolling metric for comparison

                const diff = Math.abs(postgresValue - redisValue);
                // Allow a small epsilon for floating point math if necessary, but here we expect precision
                if (diff > 0.0001) {
                    totalMismatches++;
                    riskReconcileMismatchesTotal.inc();

                    this.logger.warn({
                        userId: row.user_id,
                        marketId: row.canonical_market_id,
                        postgresValue,
                        redisValue,
                        diff
                    }, "Risk exposure mismatch detected.");

                    await this.logMismatch(row.user_id, row.canonical_market_id, row.side, postgresValue, redisValue, diff);

                    if (this.autoFix) {
                        this.logger.info({ userId: row.user_id, marketId: row.canonical_market_id }, "Auto-fixing Redis exposure mismatch.");
                        // Default TTL for rolling exposure - using 24 hours as a standard "rolling" window if not specified
                        const TTL_24H = 24 * 60 * 60 * 1000;
                        await this.exposureCache.setRollingExposure(row.user_id, row.canonical_market_id, postgresValue, TTL_24H);

                        // Update log to mark as fixed
                        await this.pgPool.query(
                            "UPDATE risk_reconcile_log SET fixed = true WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3 AND occurred_at = (SELECT max(occurred_at) FROM risk_reconcile_log WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3)",
                            [row.user_id, row.canonical_market_id, row.side]
                        );
                    }
                }
            }

            if (!options.fullReconcile && rows.length < options.batchSize) break;
            offset += options.batchSize;
        }

        this.logger.info({ totalMismatches }, "Risk reconciliation job completed.");
        return { mismatches: totalMismatches };
    }

    private async logMismatch(
        userId: string,
        marketId: string,
        side: string,
        pgVal: number,
        redisVal: number,
        diff: number
    ): Promise<void> {
        await this.pgPool.query(
            `INSERT INTO risk_reconcile_log (user_id, canonical_market_id, side, postgres_value, redis_value, diff, fixed)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [userId, marketId, side, pgVal, redisVal, diff]
        );
    }
}

// CLI Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
    const env = loadEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const pgPool = createPgPool({ databaseUrl: env.DATABASE_URL, logger });
    const redis = createRedisClient({ redisUrl: env.REDIS_URL, logger });

    await connectRedis(redis);

    const autoFix = process.env.RISK_AUTO_FIX === "true";
    const job = new RiskReconciliationJob(pgPool, redis, logger, autoFix);

    const fullReconcile = process.argv.includes("--full");
    const batchSize = 100;

    try {
        const result = await job.run({ batchSize, fullReconcile });
        if (result.mismatches > 0 && !autoFix) {
            process.exit(1);
        }
        process.exit(0);
    } catch (error) {
        logger.error({ err: error }, "Risk reconciliation job failed.");
        process.exit(1);
    }
}
