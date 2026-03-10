import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import type { InternalOrder, Trade } from "./types.js";
import type { OrderBook } from "./order-book.js";
import type { OrderLocker } from "./locker.js";

export class InternalCrossingEngine {
    constructor(
        private readonly pool: Pool,
        private readonly orderBook: OrderBook,
        private readonly orderLocker: OrderLocker,
        private readonly logger: Logger
    ) { }

    /**
     * Attempts to match an incoming order against the resting order book.
     * Atomic, concurrency-safe, and follows price-time priority.
     */
    async attemptCross(incomingOrder: InternalOrder): Promise<{
        filledSize: number;
        remainingSize: number;
        trades: Trade[];
    }> {
        let remainingTakerSize = Number(incomingOrder.remaining_size);
        let filledTakerSize = 0;
        const trades: Trade[] = [];

        this.logger.info({
            orderId: incomingOrder.id,
            marketId: incomingOrder.market_id,
            side: incomingOrder.side,
            size: remainingTakerSize
        }, "Starting internal cross attempt.");

        while (remainingTakerSize > 0) {
            // 1. Identify compatible resting orders from the Redis book
            // We fetch a small batch to minimize lock contention
            const candidates = await this.orderBook.getBestOppositeOrders(
                incomingOrder.market_id,
                incomingOrder.side,
                Number(incomingOrder.price),
                10
            );

            if (candidates.length === 0) {
                this.logger.info({ orderId: incomingOrder.id }, "No more compatible resting orders found.");
                break;
            }

            for (const makerEntry of candidates) {
                if (remainingTakerSize <= 0) break;

                // 2. Self-Trade Prevention (CANCEL_NEWEST)
                // If the taker matches their own maker order, we cancel the incoming order.
                if (makerEntry.userId === incomingOrder.user_id) {
                    this.logger.warn({
                        takerId: incomingOrder.user_id,
                        makerOrderId: makerEntry.orderId
                    }, "Self-trade detected (CANCEL_NEWEST). Cancelling incoming order.");

                    remainingTakerSize = 0;
                    break;
                }

                // 3. Acquire dual locks deterministically (Deadlock-safe)
                const lockHandle = await this.orderLocker.acquireDualOrderLocks(incomingOrder.id, makerEntry.orderId);

                try {
                    // 4. Atomic matching within a single Postgres transaction
                    const client = await this.pool.connect();
                    try {
                        await client.query("BEGIN");

                        // Re-validate maker state in Postgres using SELECT FOR UPDATE
                        const makerRes = await client.query(
                            `SELECT id, user_id, market_id, side, price, remaining_size::text, status, created_at
               FROM internal_orders 
               WHERE id = $1 FOR UPDATE`,
                            [makerEntry.orderId]
                        );
                        const maker = makerRes.rows[0];

                        if (!maker || maker.status !== 'OPEN' || Number(maker.remaining_size) <= 0) {
                            this.logger.info({ makerOrderId: makerEntry.orderId }, "Maker order no longer available or filled. Skipping.");
                            await client.query("ROLLBACK");
                            continue;
                        }

                        // Calculate exact match size
                        const matchSize = Math.min(remainingTakerSize, Number(maker.remaining_size));
                        const matchPrice = Number(maker.price);

                        // Insert Trade record
                        const tradeId = randomUUID();
                        const buyOrderId = incomingOrder.side === 'buy' ? incomingOrder.id : maker.id;
                        const sellOrderId = incomingOrder.side === 'sell' ? incomingOrder.id : maker.id;

                        await client.query(
                            `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
               VALUES ($1, $2, $3, $4, $5, $6)`,
                            [tradeId, incomingOrder.market_id, buyOrderId, sellOrderId, matchPrice, matchSize]
                        );

                        // Update maker order state
                        const newMakerRemaining = Number(maker.remaining_size) - matchSize;
                        const newMakerStatus = newMakerRemaining === 0 ? 'FILLED' : 'OPEN';
                        await client.query(
                            "UPDATE internal_orders SET remaining_size = $1, status = $2, updated_at = NOW() WHERE id = $3",
                            [newMakerRemaining, newMakerStatus, maker.id]
                        );

                        // Update Exposure for both users
                        // We implement the delta math here to ensure atomicity within THIS transaction.
                        const takerDeltaGross = matchSize * matchPrice;
                        const takerDeltaNet = incomingOrder.side === 'buy' ? takerDeltaGross : -takerDeltaGross;

                        const makerDeltaGross = matchSize * matchPrice;
                        const makerDeltaNet = maker.side === 'buy' ? makerDeltaGross : -makerDeltaGross;

                        await this.atomicUpdateExposure(client, incomingOrder.user_id, incomingOrder.market_id, incomingOrder.side, takerDeltaGross, takerDeltaNet, tradeId);
                        await this.atomicUpdateExposure(client, maker.user_id, incomingOrder.market_id, maker.side, makerDeltaGross, makerDeltaNet, tradeId);

                        await client.query("COMMIT");

                        // 5. Update Redis book state AFTER commit
                        if (newMakerStatus === 'FILLED') {
                            // Note: maker.created_at is required to calculate the exact member string score
                            await this.orderBook.removeOrder({
                                id: maker.id,
                                market_id: maker.market_id,
                                side: maker.side,
                                created_at: new Date(maker.created_at)
                            } as any);
                        } else {
                            await this.orderBook.updateRemaining(incomingOrder.market_id, maker.id, newMakerRemaining);
                        }

                        filledTakerSize += matchSize;
                        remainingTakerSize -= matchSize;
                        trades.push({
                            id: tradeId,
                            market_id: incomingOrder.market_id,
                            buy_order_id: buyOrderId,
                            sell_order_id: sellOrderId,
                            price: matchPrice.toString(),
                            size: matchSize.toString(),
                            created_at: new Date()
                        });

                        this.logger.info({ tradeId, matchSize, matchPrice }, "Match successful.");

                    } catch (e) {
                        await client.query("ROLLBACK");
                        this.logger.error({ err: e, takerId: incomingOrder.id, makerId: makerEntry.orderId }, "Transaction failed during matching.");
                        throw e;
                    } finally {
                        client.release();
                    }
                } finally {
                    // 6. Release order-level locks
                    await this.orderLocker.releaseLocks(lockHandle);
                }
            }
        }

        return {
            filledSize: filledTakerSize,
            remainingSize: remainingTakerSize,
            trades
        };
    }

    /**
     * Performs an atomic exposure update within an existing transaction.
     * Includes journal insertion for auditability.
     */
    private async atomicUpdateExposure(
        client: PoolClient,
        userId: string,
        marketId: string,
        side: "buy" | "sell",
        deltaGross: number,
        deltaNet: number,
        tradeId: string
    ): Promise<void> {
        // 1. Get/Lock exposure row
        const expRes = await client.query(
            `SELECT id, gross_notional::text, net_notional::text 
       FROM exposure 
       WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3
       FOR UPDATE`,
            [userId, marketId, side]
        );

        let exposure = expRes.rows[0];
        const prevGross = exposure ? Number.parseFloat(exposure.gross_notional) : 0;
        const prevNet = exposure ? Number.parseFloat(exposure.net_notional) : 0;
        const newGross = prevGross + deltaGross;
        const newNet = prevNet + deltaNet;

        let exposureId: string;

        if (!exposure) {
            const createRes = await client.query(
                `INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
                [userId, marketId, side, newGross, newNet]
            );
            exposureId = createRes.rows[0].id;
        } else {
            exposureId = exposure.id;
            await client.query(
                `UPDATE exposure 
         SET gross_notional = $1, net_notional = $2, last_updated = NOW(), version = version + 1
         WHERE id = $3`,
                [newGross, newNet, exposureId]
            );
        }

        // 2. Insert into journal
        await client.query(
            `INSERT INTO exposure_journal (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [exposureId, deltaNet, prevGross, prevNet, newGross, newNet, "internal-match", tradeId]
        );
    }
}
