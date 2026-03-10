-- Up Migration (2026_03_06_create_internal_trades.sql)

CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id TEXT NOT NULL,
    buy_order_id UUID NOT NULL,
    sell_order_id UUID NOT NULL,
    price NUMERIC NOT NULL CHECK (price > 0),
    size NUMERIC NOT NULL CHECK (size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Enforces idempotency for a match between two specific resting/incoming orders.
    -- In a deterministic price-time priority engine, two specific orders will only match 
    -- against each other exactly once.
    CONSTRAINT uq_trades_match UNIQUE (buy_order_id, sell_order_id)
);

CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_buy_order_id ON trades(buy_order_id);
CREATE INDEX IF NOT EXISTS idx_trades_sell_order_id ON trades(sell_order_id);

-- Down Migration

-- DROP TABLE IF EXISTS trades;
