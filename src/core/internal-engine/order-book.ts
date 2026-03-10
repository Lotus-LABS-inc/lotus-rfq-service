import type { InternalOrder, RedisBookOrder } from "./types.js";

import type { RedisClient } from "../../db/redis.js";

export class OrderBook {
    constructor(private readonly redis: RedisClient) { }

    async getOrderSnapshot(orderId: string): Promise<{ key: string; raw: string | null }> {
        const key = this.orderKey(orderId);
        return {
            key,
            raw: await this.redis.get(key)
        };
    }

    async addOrder(order: InternalOrder): Promise<RedisBookOrder> {
        const bookOrder = this.toBookOrder(order);

        await Promise.all([
            this.redis.zadd(this.bookKey(bookOrder.marketId, bookOrder.side), this.scoreFor(bookOrder.side, bookOrder.price), bookOrder.member),
            this.redis.set(this.orderKey(bookOrder.orderId), JSON.stringify(bookOrder), "PX", 86_400_000)
        ]);

        return bookOrder;
    }

    async removeOrder(orderId: string): Promise<boolean> {
        const existing = await this.getOrderById(orderId);
        if (existing === null) {
            return false;
        }

        const removedCount = await this.redis.zrem(this.bookKey(existing.marketId, existing.side), existing.member);
        await this.redis.del(this.orderKey(orderId));

        return removedCount > 0;
    }

    async updateRemaining(orderId: string, remaining: string | number): Promise<RedisBookOrder | null> {
        const existing = await this.getOrderById(orderId);
        if (existing === null) {
            return null;
        }

        const updated: RedisBookOrder = {
            ...existing,
            remaining: this.normalizeNumericString(remaining, "remaining")
        };

        await this.redis.set(this.orderKey(orderId), JSON.stringify(updated), "PX", 86_400_000);

        return updated;
    }

    async getBestOppositeOrders(
        marketId: string,
        takerSide: "buy" | "sell",
        priceLimit: string | number,
        limit: number = 50
    ): Promise<ReadonlyArray<RedisBookOrder>> {
        const oppositeSide: "buy" | "sell" = takerSide === "buy" ? "sell" : "buy";
        const normalizedPriceLimit = this.normalizeNumericString(priceLimit, "priceLimit");
        const members = await this.redis.zrangebyscore(
            this.bookKey(marketId, oppositeSide),
            "-inf",
            this.scoreFor(oppositeSide, normalizedPriceLimit),
            "LIMIT",
            0,
            limit
        );

        const orders: RedisBookOrder[] = [];

        for (const member of members) {
            const orderId = this.extractOrderId(member);
            if (orderId === null) {
                continue;
            }

            const entry = await this.getOrderById(orderId);
            if (entry === null) {
                await this.redis.zrem(this.bookKey(marketId, oppositeSide), member);
                continue;
            }

            orders.push(entry);
        }

        return orders;
    }

    private toBookOrder(order: InternalOrder): RedisBookOrder {
        const createdAtMs = order.created_at.getTime();

        return {
            orderId: order.id,
            marketId: order.market_id,
            side: order.side,
            member: this.memberFor(createdAtMs, order.id),
            price: this.normalizeNumericString(order.price, "price"),
            remaining: this.normalizeNumericString(order.remaining_size, "remaining_size"),
            userId: order.user_id,
            createdAtMs
        };
    }

    private scoreFor(side: "buy" | "sell", price: string): number {
        const numericPrice = Number(price);
        if (!Number.isFinite(numericPrice)) {
            throw new Error(`Invalid numeric price: ${price}`);
        }

        return side === "buy" ? -numericPrice : numericPrice;
    }

    private orderKey(orderId: string): string {
        return `book:order:${orderId}`;
    }

    private bookKey(marketId: string, side: "buy" | "sell"): string {
        return `book:${marketId}:${side.toUpperCase()}`;
    }

    private memberFor(createdAtMs: number, orderId: string): string {
        return `${createdAtMs.toString().padStart(15, "0")}:${orderId}`;
    }

    private extractOrderId(member: string): string | null {
        const separatorIndex = member.indexOf(":");
        if (separatorIndex === -1 || separatorIndex === member.length - 1) {
            return null;
        }

        return member.slice(separatorIndex + 1);
    }

    private normalizeNumericString(value: string | number, field: string): string {
        const normalized = typeof value === "number" ? value.toString() : value;
        if (normalized.trim().length === 0 || !Number.isFinite(Number(normalized))) {
            throw new Error(`Invalid numeric value for ${field}`);
        }

        return normalized;
    }

    private async getOrderById(orderId: string): Promise<RedisBookOrder | null> {
        const raw = await this.redis.get(this.orderKey(orderId));
        if (raw === null) {
            return null;
        }

        const parsed = JSON.parse(raw) as Partial<RedisBookOrder>;
        if (
            typeof parsed.orderId !== "string" ||
            typeof parsed.marketId !== "string" ||
            (parsed.side !== "buy" && parsed.side !== "sell") ||
            typeof parsed.member !== "string" ||
            typeof parsed.price !== "string" ||
            typeof parsed.remaining !== "string" ||
            typeof parsed.userId !== "string" ||
            typeof parsed.createdAtMs !== "number"
        ) {
            await this.redis.del(this.orderKey(orderId));
            return null;
        }

        return parsed as RedisBookOrder;
    }
}
