-- Up Migration (2026_03_06_create_internal_orders.sql)

DO $$ BEGIN
    CREATE TYPE internal_order_status AS ENUM ('OPEN', 'FILLED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS internal_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    price NUMERIC NOT NULL CHECK (price > 0),
    initial_size NUMERIC NOT NULL CHECK (initial_size > 0),
    remaining_size NUMERIC NOT NULL CHECK (remaining_size >= 0),
    status internal_order_status NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_orders_market_status ON internal_orders(market_id, status);
CREATE INDEX IF NOT EXISTS idx_internal_orders_user_id ON internal_orders(user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_internal_orders_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_internal_orders_timestamp ON internal_orders;
CREATE TRIGGER trg_update_internal_orders_timestamp
BEFORE UPDATE ON internal_orders
FOR EACH ROW
EXECUTE FUNCTION update_internal_orders_timestamp();

-- Down Migration

-- DROP TABLE IF EXISTS internal_orders;
-- DROP TYPE IF EXISTS internal_order_status;
