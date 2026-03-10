import type { InternalOrder } from "./types.js";

import type { RedisClient } from "../../db/redis.js";

export interface OrderBookEntry {
    orderId: string;
    price: number;
    remainingSize: number;
    userId: string;
    timestamp: number;
}

export class OrderBook {
    constructor(private readonly redis: RedisClient) { }

    /**
     * Adds an order to the live book.
     * Price-Time priority is enforced by using:
     * - BUY: Score = -price, Member = timestamp:orderId
     * - SELL: Score = price, Member = timestamp:orderId
     */
    async addOrder(order: InternalOrder): Promise<void> {
        const marketId = order.market_id;
        const side = order.side.toUpperCase();
        const price = Number(order.price);
        const timestamp = order.created_at.getTime();

        const score = side === "BUY" ? -price : price;
        const member = `${timestamp.toString().padStart(15, "0")}:${order.id}`;
        const zkey = `book:${marketId}:${side}`;
        const hkey = `order_details:${marketId}`;

        const entry: OrderBookEntry = {
            orderId: order.id,
            price,
            remainingSize: Number(order.remaining_size),
            userId: order.user_id,
            timestamp
        };

        // We use a simplified HSET for order metadata for fast lookup during matching
        await Promise.all([
            this.redis.zadd(zkey, score, member),
            this.redis.hset(hkey, order.id, JSON.stringify(entry))
        ]);
    }

    /**
     * Removes an order from the book.
     * Requires searching for the member by ID if timestamp isn't known, 
     * but in this system we usually have the original order object.
     */
    async removeOrder(order: InternalOrder): Promise<void> {
        const marketId = order.market_id;
        const side = order.side.toUpperCase();
        const timestamp = order.created_at.getTime();
        const member = `${timestamp.toString().padStart(15, "0")}:${order.id}`;

        const zkey = `book:${marketId}:${side}`;
        const hkey = `order_details:${marketId}`;

        await Promise.all([
            this.redis.zrem(zkey, member),
            this.redis.hdel(hkey, order.id)
        ]);
    }

    /**
     * Updates only the remaining size of a resting order.
     */
    async updateRemaining(marketId: string, orderId: string, remaining: number): Promise<void> {
        const hkey = `order_details:${marketId}`;
        const existing = await this.redis.hget(hkey, orderId);
        if (!existing) return;

        const entry: OrderBookEntry = JSON.parse(existing);
        entry.remainingSize = remaining;

        await this.redis.hset(hkey, orderId, JSON.stringify(entry));
    }

    /**
     * Fetch best opposite orders that satisfy the price limit.
     * For BUY Match: Fetch SELL orders (score ascending) where score <= taker_buy_price
     * For SELL Match: Fetch BUY orders (score ascending, which is -price) where score <= -taker_sell_price
     */
    async getBestOppositeOrders(
        marketId: string,
        takerSide: "buy" | "sell",
        takerPrice: number,
        limit: number = 50
    ): Promise<OrderBookEntry[]> {
        const oppositeSide = takerSide === "buy" ? "SELL" : "BUY";
        const zkey = `book:${marketId}:${oppositeSide}`;
        const hkey = `order_details:${marketId}`;

        // For SELL book, min score is 0, max score is takerPrice (buy price)
        // For BUY book, min score is -infinity, max score is -takerPrice (sell price)
        const maxScore = takerSide === "buy" ? takerPrice : -takerPrice;

        // ZRANGEBYSCORE key -inf maxScore LIMIT 0 limit
        const members = await this.redis.zrangebyscore(zkey, "-inf", maxScore, "LIMIT", 0, limit);

        if (members.length === 0) return [];

        const orderIds = members.map(m => m.split(":")[1] as string);
        const entries: OrderBookEntry[] = [];

        for (const id of orderIds) {
            const data = await this.redis.hget(hkey, id);
            if (data) {
                entries.push(JSON.parse(data));
            }
        }

        return entries;
    }
}
