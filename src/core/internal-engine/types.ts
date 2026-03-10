/**
 * Represents a settled match between a buyer and a seller in the Internal Crossing Engine.
 */
export interface Trade {
    id: string;
    market_id: string;
    buy_order_id: string;
    sell_order_id: string;

    // Stored as NUMERIC in Postgres. Handle as string to prevent floating-point precision loss.
    price: string;
    size: string;

    created_at: Date;
}

/**
 * Payload required to persist a new trade from the matching engine.
 */
export interface CreateTradeInput {
    id?: string;
    market_id: string;
    buy_order_id: string;
    sell_order_id: string;
    price: string | number;
    size: string | number;
}

export interface RedisBookOrder {
    orderId: string;
    marketId: string;
    side: "buy" | "sell";
    member: string;
    price: string;
    remaining: string;
    userId: string;
    createdAtMs: number;
}

export type InternalOrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED';

/**
 * Represents a resting maker order in the Internal Crossing Engine.
 */
export interface InternalOrder {
    id: string;
    market_id: string;
    user_id: string;
    side: 'buy' | 'sell';
    price: string;
    initial_size: string;
    remaining_size: string;
    status: InternalOrderStatus;
    created_at: Date;
    updated_at: Date;
}

/**
 * Payload required to create a new resting order.
 */
export interface CreateOrderInput {
    market_id: string;
    user_id: string;
    side: 'buy' | 'sell';
    price: string | number;
    size: string | number;
}

