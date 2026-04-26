CREATE TABLE IF NOT EXISTS funding_withdrawal_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    destination_chain TEXT NOT NULL,
    destination_wallet_address TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    aggregate_route_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_estimated_fees TEXT NOT NULL DEFAULT '0',
    total_estimated_time_seconds INTEGER,
    audit_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_intents_user_status
    ON funding_withdrawal_intents(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS funding_withdrawal_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_intent_id UUID NOT NULL REFERENCES funding_withdrawal_intents(id) ON DELETE CASCADE,
    source_venue TEXT NOT NULL,
    source_token TEXT NOT NULL,
    source_amount TEXT NOT NULL,
    source_percentage NUMERIC,
    venue_capability_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_sources_intent
    ON funding_withdrawal_sources(withdrawal_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_sources_venue_status
    ON funding_withdrawal_sources(source_venue, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS funding_withdrawal_route_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_intent_id UUID NOT NULL REFERENCES funding_withdrawal_intents(id) ON DELETE CASCADE,
    withdrawal_source_id UUID NOT NULL REFERENCES funding_withdrawal_sources(id) ON DELETE CASCADE,
    source_venue TEXT NOT NULL,
    source_token TEXT NOT NULL,
    source_amount TEXT NOT NULL,
    destination_chain TEXT NOT NULL,
    destination_wallet_address TEXT NOT NULL,
    destination_amount_estimate TEXT NOT NULL,
    route_provider TEXT NOT NULL,
    route_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
    tx_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    venue_release_status TEXT NOT NULL,
    destination_status TEXT NOT NULL,
    status TEXT NOT NULL,
    error_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_route_legs_intent
    ON funding_withdrawal_route_legs(withdrawal_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_route_legs_status
    ON funding_withdrawal_route_legs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS funding_withdrawal_reconciliation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_intent_id UUID NOT NULL REFERENCES funding_withdrawal_intents(id) ON DELETE CASCADE,
    withdrawal_route_leg_id UUID NOT NULL REFERENCES funding_withdrawal_route_legs(id) ON DELETE CASCADE,
    source_venue TEXT NOT NULL,
    withdrawal_tx_hash TEXT,
    venue_released BOOLEAN NOT NULL DEFAULT false,
    destination_received BOOLEAN NOT NULL DEFAULT false,
    completed BOOLEAN NOT NULL DEFAULT false,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_reconciliation_completed
    ON funding_withdrawal_reconciliation_records(source_venue, completed, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_reconciliation_intent
    ON funding_withdrawal_reconciliation_records(withdrawal_intent_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS funding_withdrawal_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_intent_id UUID NOT NULL REFERENCES funding_withdrawal_intents(id) ON DELETE CASCADE,
    withdrawal_route_leg_id UUID REFERENCES funding_withdrawal_route_legs(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_audit_events_intent
    ON funding_withdrawal_audit_events(withdrawal_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_withdrawal_audit_events_leg
    ON funding_withdrawal_audit_events(withdrawal_route_leg_id, created_at ASC);
