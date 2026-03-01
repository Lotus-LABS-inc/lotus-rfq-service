import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { riskInternalErrorTotal } from "../observability/metrics.js";

export interface ExposureRow {
    id: string;
    user_id: string;
    canonical_market_id: string;
    side: "buy" | "sell";
    gross_notional: string;
    net_notional: string;
    last_updated: Date;
    version: string;
}

export interface IExposureRepository {
    getExposureForUpdate(
        userId: string,
        marketId: string,
        side: string,
        client: PoolClient
    ): Promise<ExposureRow | null>;

    createExposure(
        userId: string,
        marketId: string,
        side: string,
        initialGross: number,
        initialNet: number,
        client: PoolClient
    ): Promise<ExposureRow>;

    updateExposureWithJournal(
        userId: string,
        marketId: string,
        side: "buy" | "sell",
        deltaGross: number,
        deltaNet: number,
        source: string,
        referenceId: string,
        payload?: Record<string, unknown>
    ): Promise<void>;

    applyExecutionIdempotent(executionId: string): Promise<boolean>;

    listAllExposures(limit?: number, offset?: number): Promise<ExposureRow[]>;
    getExposure(userId: string, marketId: string, side: "buy" | "sell"): Promise<ExposureRow | null>;
}

export class ExposureRepository implements IExposureRepository {
    public constructor(
        private readonly pool: Pool,
        private readonly logger: Logger
    ) { }

    public async getExposureForUpdate(
        userId: string,
        marketId: string,
        side: string,
        client: PoolClient
    ): Promise<ExposureRow | null> {
        const res = await client.query<ExposureRow>(
            `SELECT id, user_id, canonical_market_id, side, gross_notional::text, net_notional::text, last_updated, version::text
       FROM exposure
       WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3
       FOR UPDATE`,
            [userId, marketId, side]
        );
        return res.rows[0] || null;
    }

    public async createExposure(
        userId: string,
        marketId: string,
        side: string,
        initialGross: number,
        initialNet: number,
        client: PoolClient
    ): Promise<ExposureRow> {
        const res = await client.query<ExposureRow>(
            `INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, canonical_market_id, side, gross_notional::text, net_notional::text, last_updated, version::text`,
            [userId, marketId, side, initialGross, initialNet]
        );
        if (res.rows.length === 0) {
            throw new Error("Failed to create exposure row");
        }
        return res.rows[0] as ExposureRow;
    }

    public async updateExposureWithJournal(
        userId: string,
        marketId: string,
        side: "buy" | "sell",
        deltaGross: number,
        deltaNet: number,
        source: string,
        referenceId: string,
        payload: Record<string, unknown> = {}
    ): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            const exposure = await this.getExposureForUpdate(userId, marketId, side, client);

            const prevGross = exposure ? Number.parseFloat(exposure.gross_notional) : 0;
            const prevNet = exposure ? Number.parseFloat(exposure.net_notional) : 0;

            const newGross = prevGross + deltaGross;
            const newNet = prevNet + deltaNet;

            let exposureId: string;

            if (!exposure) {
                const created = await this.createExposure(userId, marketId, side, newGross, newNet, client);
                exposureId = created.id;
            } else {
                exposureId = exposure.id;
                await client.query(
                    `UPDATE exposure 
           SET gross_notional = $1, net_notional = $2, last_updated = NOW(), version = version + 1
           WHERE id = $3`,
                    [newGross, newNet, exposureId]
                );
            }

            await client.query(
                `INSERT INTO exposure_journal (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [exposureId, deltaNet, prevGross, prevNet, newGross, newNet, source, referenceId, JSON.stringify(payload)]
            );

            await client.query("COMMIT");
            this.logger.info({ userId, marketId, side, deltaNet, source, referenceId }, "Updated exposure with journal entry.");
        } catch (error) {
            await client.query("ROLLBACK");
            riskInternalErrorTotal.inc({ operation: "update_exposure_with_journal" });
            this.logger.error({ err: error, userId, marketId, side, source, referenceId }, "Failed to update exposure with journal.");
            throw error;
        } finally {
            client.release();
        }
    }

    public async applyExecutionIdempotent(executionId: string): Promise<boolean> {
        try {
            await this.pool.query(
                "INSERT INTO exposure_idempotency (id) VALUES ($1)",
                [executionId]
            );
            return true;
        } catch (error: any) {
            if (error.code === "23505") { // unique_violation in Postgres
                return false;
            }
            riskInternalErrorTotal.inc({ operation: "apply_execution_idempotent" });
            this.logger.error({ err: error, executionId }, "Failed to check execution idempotency.");
            throw error;
        }
    }

    public async listAllExposures(limit = 100, offset = 0): Promise<ExposureRow[]> {
        const res = await this.pool.query<ExposureRow>(
            `SELECT id, user_id, canonical_market_id, side, gross_notional::text, net_notional::text, last_updated, version::text
       FROM exposure
       ORDER BY last_updated DESC
       LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return res.rows;
    }

    public async getExposure(userId: string, marketId: string, side: "buy" | "sell"): Promise<ExposureRow | null> {
        const res = await this.pool.query<ExposureRow>(
            `SELECT id, user_id, canonical_market_id, side, gross_notional::text, net_notional::text, last_updated, version::text
       FROM exposure
       WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3`,
            [userId, marketId, side]
        );
        return res.rows[0] || null;
    }
}
