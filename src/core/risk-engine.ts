import type { Logger } from "pino";
import type { Pool, PoolClient } from "pg";
import type { IExposureRepository } from "../repositories/exposure.repository.js";
import type { ExposureRedisCache } from "../repositories/exposure-redis-cache.js";
import type { CanonicalMarketClient } from "./rfq-engine/canonical-market-client.js";
import type { RFQSessionRecord } from "../db/repositories/rfq-session-repository.js";
import type { RFQQuoteRecord } from "../db/repositories/rfq-quote-repository.js";
import {
    riskValidationRejectedTotal,
    riskInternalErrorTotal,
    riskExposureCurrent,
    riskReconciliationDiffTotal,
    riskValidationLatencyMs,
    riskLockWaitTimeMs,
    riskExposureUpdatesTotal,
    riskReservationsActive,
    riskTotalGrossExposure,
    riskTotalNetExposure
} from "../observability/metrics.js";

export type ReservationToken = string;

export class RiskRejectedError extends Error {
    public constructor(public readonly reason: string) {
        super(`Risk rejection: ${reason}`);
        this.name = "RiskRejectedError";
    }
}

export interface RiskConfig {
    userNotionalCap: number;
    marketNotionalCap: number;
    lpNotionalCap: number;
    globalNotionalCap: number;
    maxOrderNotional: number;
    autoFixReconciliation?: boolean;
}

export interface IRiskEngine {
    validateRFQCreation(rfq: { taker_id: string; canonical_market_id: string; side: "buy" | "sell"; quantity: string; id?: string }): Promise<void>;
    validateBeforeExecution(rfq: RFQSessionRecord, quote: RFQQuoteRecord): Promise<ReservationToken>;
    updateExposureAfterExecution(executionResult: Record<string, unknown>, isInternal?: boolean): Promise<void>;
    reconcileExposureSnapshot(): Promise<void>;
}

export class RiskEngine implements IRiskEngine {
    public constructor(
        private readonly exposureRepository: IExposureRepository,
        private readonly redisCache: ExposureRedisCache,
        private readonly canonicalClient: CanonicalMarketClient,
        private readonly pool: Pool,
        private readonly config: RiskConfig,
        private readonly logger: Logger
    ) { }

    public async validateRFQCreation(rfq: { taker_id: string; canonical_market_id: string; side: "buy" | "sell"; quantity: string; id?: string }): Promise<void> {
        try {
            const market = await this.canonicalClient.fetchMarketById(rfq.canonical_market_id);
            // For single market RFQ, we assume mid-price is available or fixed for simplicity here
            // Real implementation would fetch mid-price from market oracle or similar
            const midPrice = 1.0; // Placeholder: mid-price should be fetched

            const notional = Number.parseFloat(rfq.quantity) * midPrice;

            const startTime = Date.now();
            if (notional > this.config.maxOrderNotional) {
                riskValidationRejectedTotal.inc({ reason: "MAX_ORDER_NOTIONAL" });
                throw new RiskRejectedError(`Order notional ${notional} exceeds max ${this.config.maxOrderNotional}`);
            }

            const rollingUserExposure = await this.redisCache.getRollingExposure(rfq.taker_id, rfq.canonical_market_id);

            const client = await this.pool.connect();
            try {
                // We check authoritative state too, though it might be slower
                const authRes = await client.query(
                    "SELECT SUM(gross_notional) as total_gross FROM exposure WHERE user_id = $1",
                    [rfq.taker_id]
                );
                const authUserExposure = Number.parseFloat(authRes.rows[0].total_gross || "0");

                if (authUserExposure + notional > this.config.userNotionalCap) {
                    riskValidationRejectedTotal.inc({ reason: "USER_NOTIONAL_CAP" });
                    throw new RiskRejectedError("User notional cap exceeded");
                }

                const marketRes = await client.query(
                    "SELECT SUM(gross_notional) as total_gross FROM exposure WHERE canonical_market_id = $1",
                    [rfq.canonical_market_id]
                );
                const authMarketExposure = Number.parseFloat(marketRes.rows[0].total_gross || "0");

                if (authMarketExposure + notional > this.config.marketNotionalCap) {
                    riskValidationRejectedTotal.inc({ reason: "MARKET_NOTIONAL_CAP" });
                    throw new RiskRejectedError("Market notional cap exceeded");
                }

                const globalRes = await client.query("SELECT SUM(gross_notional) as total_gross FROM exposure");
                const authGlobalExposure = Number.parseFloat(globalRes.rows[0].total_gross || "0");

                if (authGlobalExposure + notional > this.config.globalNotionalCap) {
                    riskValidationRejectedTotal.inc({ reason: "GLOBAL_NOTIONAL_CAP" });
                    throw new RiskRejectedError("Global notional cap exceeded");
                }

                riskTotalGrossExposure.set(authGlobalExposure);
            } finally {
                client.release();
            }

            riskValidationLatencyMs.observe(Date.now() - startTime);
            this.logger.info({ sessionId: rfq.id, takerId: rfq.taker_id, notional }, "RFQ creation risk validation success.");
        } catch (error) {
            if (error instanceof RiskRejectedError) {
                throw error;
            }
            riskInternalErrorTotal.inc({ operation: "validate_rfq_creation" });
            this.logger.error({ err: error, sessionId: rfq.id }, "Risk engine internal failure during RFQ creation validation.");
            throw error; // Fail-Closed
        }
    }

    public async validateBeforeExecution(rfq: RFQSessionRecord, quote: RFQQuoteRecord): Promise<ReservationToken> {
        const startTime = Date.now();
        const lockKey = `risk:lock:exec:${rfq.id}`;

        const lockStartTime = Date.now();
        let lockToken: string | null = null;
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
            lockToken = await this.redisCache.lockExposureKey(lockKey, 5000);
            if (lockToken) break;

            attempts++;
            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50 * attempts)); // Exponential-ish backoff
            }
        }

        riskLockWaitTimeMs.observe(Date.now() - lockStartTime);

        if (!lockToken) {
            throw new Error(`Unable to acquire risk lock for execution after ${attempts} attempts`);
        }

        riskReservationsActive.inc();

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Check for existing reservation
            const existingRes = await client.query(
                "SELECT id FROM exposure_journal WHERE reference_id = $1 AND source = 'pre-exec-reserve'",
                [rfq.id]
            );
            if (existingRes.rows.length > 0) {
                throw new Error("Reservation already exists for this RFQ");
            }

            const notional = Number.parseFloat(quote.quantity) * Number.parseFloat(quote.price);

            // Self-Trade Prevention (STP) check
            this.checkSTP(rfq, quote);

            // Select for update on exposure rows
            const exposure = await this.exposureRepository.getExposureForUpdate(rfq.taker_id, rfq.canonical_market_id, rfq.side, client);

            const currentGross = exposure ? Number.parseFloat(exposure.gross_notional) : 0;
            if (currentGross + notional > this.config.userNotionalCap) {
                throw new RiskRejectedError("User notional cap exceeded at execution");
            }

            // Record reservation in journal
            const exposureId = exposure?.id || "00000000-0000-0000-0000-000000000000";
            await client.query(
                `INSERT INTO exposure_journal (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [exposureId, 0, currentGross, 0, currentGross, 0, "pre-exec-reserve", rfq.id]
            );

            await client.query("COMMIT");
            riskValidationLatencyMs.observe(Date.now() - startTime);
            this.logger.info({ sessionId: rfq.id, quoteId: quote.id, lockKey }, "Risk validation success before execution.");
            return lockToken;
        } catch (error) {
            await client.query("ROLLBACK");
            await this.redisCache.unlockExposureKey(lockKey, lockToken);
            riskReservationsActive.dec();
            if (error instanceof RiskRejectedError) {
                riskValidationRejectedTotal.inc({ reason: "EXECUTION_CAP" });
                throw error;
            }
            riskInternalErrorTotal.inc({ operation: "validate_before_execution" });
            throw error;
        } finally {
            client.release();
        }
    }

    public async updateExposureAfterExecution(exec: Record<string, unknown>, isInternal = false): Promise<void> {
        const rfqId = exec.sessionId as string;
        const executionId = exec.id as string;
        const userId = exec.takerId as string;
        const marketId = exec.canonicalMarketId as string;
        const side = exec.side as "buy" | "sell";
        const deltaGross = Number.parseFloat(exec.executedQuantity as string) * Number.parseFloat(exec.executedPrice as string);
        const deltaNet = side === "buy" ? deltaGross : -deltaGross;

        const isFirstTime = await this.exposureRepository.applyExecutionIdempotent(executionId);
        if (!isFirstTime) {
            this.logger.info({ executionId }, "Exposure already updated for this execution (idempotent).");
            return;
        }

        try {
            await this.exposureRepository.updateExposureWithJournal(
                userId,
                marketId,
                side,
                deltaGross,
                deltaNet,
                "rfq-execution",
                executionId,
                { rfqId }
            );

            // Update Redis rolling
            await this.redisCache.incRollingExposure(userId, marketId, deltaGross, 3600000); // 1 hour TTL for rolling

            riskReservationsActive.dec();
            riskExposureUpdatesTotal.inc();

            riskExposureCurrent.set({ user_id: userId, market_id: marketId, side }, deltaGross); // Simple gauge update

            // Updating totals - LOOPHOLE FIX: Internal crosses are risk-neutral at the systemic level
            const totalRes = await this.pool.query("SELECT SUM(gross_notional) as gross, SUM(net_notional) as net FROM exposure");
            const newGlobalGross = Number.parseFloat(totalRes.rows[0].gross || "0");
            const newGlobalNet = Number.parseFloat(totalRes.rows[0].net || "0");

            if (!isInternal) {
                riskTotalGrossExposure.set(newGlobalGross);
                riskTotalNetExposure.set(newGlobalNet);
            } else {
                this.logger.info({ rfqId, executionId, isInternal }, "Internal cross detected; skipping global systemic exposure increment.");
            }

            this.logger.info({ rfqId, executionId, deltaGross }, "Exposure successfully updated after execution.");
        } catch (error) {
            riskInternalErrorTotal.inc({ operation: "update_exposure_after_execution" });
            this.logger.error({ err: error, rfqId, executionId }, "Failed to update exposure after execution.");
            throw error;
        }
    }

    public async reconcileExposureSnapshot(): Promise<void> {
        const BATCH_SIZE = 100;
        let offset = 0;

        while (true) {
            const exposures = await this.exposureRepository.listAllExposures(BATCH_SIZE, offset);
            if (exposures.length === 0) break;

            for (const authExp of exposures) {
                const rolling = await this.redisCache.getRollingExposure(authExp.user_id, authExp.canonical_market_id);
                const authTotal = Number.parseFloat(authExp.gross_notional);

                if (Math.abs(rolling - authTotal) > 0.001) {
                    riskReconciliationDiffTotal.set(Math.abs(rolling - authTotal));
                    this.logger.warn(
                        { userId: authExp.user_id, marketId: authExp.canonical_market_id, rolling, authTotal },
                        "Exposure discrepancy detected during reconciliation."
                    );

                    if (this.config.autoFixReconciliation) {
                        // Fix Redis by setting it to auth total
                        // (Assuming we have a setRollingExposure or similar)
                        this.logger.info("Auto-fixing exposure discrepancy (not implemented in this stub).");
                    }
                }
            }

            offset += BATCH_SIZE;
        }
    }

    private checkSTP(rfq: RFQSessionRecord, quote: RFQQuoteRecord): void {
        const takerId = rfq.taker_id;
        const providerId = quote.lp_key_id;

        // Note: In RFQSessionRecord/RFQQuoteRecord, taker_id and provider_id are the relevant identities.
        // We assume rfq.metadata contains stp_mode or default to CANCEL_NEWEST.
        const stpMode = (rfq.metadata as any)?.stp_mode || "CANCEL_NEWEST";

        if (stpMode === "NONE") return;

        if (takerId === providerId) {
            riskValidationRejectedTotal.inc({ reason: "SELF_TRADE_PREVENTION" });
            this.logger.warn({ rfqId: rfq.id, takerId, providerId, stpMode }, "Self-trade detected in RiskEngine.");
            throw new RiskRejectedError("Self-trade prevention triggered");
        }
    }
}
