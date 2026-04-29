CREATE TABLE IF NOT EXISTS monetization_fee_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    mode TEXT NOT NULL,
    currency TEXT NOT NULL,
    price_improvement_share_bps INTEGER NOT NULL,
    execution_fee_bps INTEGER NOT NULL,
    fast_lane_fee_bps INTEGER NOT NULL,
    ghost_fill_protection_fee_bps INTEGER NOT NULL,
    max_total_fee_bps INTEGER NOT NULL,
    capture_mode TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_fee_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    rfq_id TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    execution_id UUID NULL,
    user_id TEXT NOT NULL,
    fee_policy_version TEXT NOT NULL,
    fee_disclosure_hash TEXT NOT NULL,
    max_lotus_fee NUMERIC NOT NULL,
    max_pass_through_fee NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    fee_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_fee_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    execution_id UUID NULL,
    rfq_id TEXT NULL,
    quote_id TEXT NULL,
    user_id TEXT NOT NULL,
    venue TEXT NULL,
    lane_id TEXT NULL,
    fee_policy_version TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    status TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    capture_mode TEXT NULL,
    revenue_source TEXT NULL,
    actual_builder_fee_collected NUMERIC NOT NULL DEFAULT 0,
    shadow_improvement_fee NUMERIC NOT NULL DEFAULT 0,
    uncollected_improvement_opportunity NUMERIC NOT NULL DEFAULT 0,
    settlement_status TEXT NULL,
    source_event_id TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revenue_share_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_fee_ledger_id UUID NOT NULL REFERENCES execution_fee_ledger(id),
    recipient_type TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_fee_authorizations_rfq_quote
    ON execution_fee_authorizations(rfq_id, quote_id, fee_policy_version);

CREATE INDEX IF NOT EXISTS idx_execution_fee_ledger_execution
    ON execution_fee_ledger(execution_id, fee_policy_version, status);

CREATE INDEX IF NOT EXISTS idx_execution_fee_ledger_created_at
    ON execution_fee_ledger(created_at DESC);
