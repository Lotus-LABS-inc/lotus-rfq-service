CREATE TABLE IF NOT EXISTS funding_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    source_chain TEXT NOT NULL,
    source_token TEXT NOT NULL,
    source_amount TEXT NOT NULL,
    source_wallet_address TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_funding_intents_user_status
    ON funding_intents(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS funding_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_intent_id UUID NOT NULL REFERENCES funding_intents(id) ON DELETE CASCADE,
    target_venue TEXT NOT NULL,
    target_chain TEXT NOT NULL,
    target_token TEXT NOT NULL,
    target_amount TEXT NOT NULL,
    target_percentage NUMERIC,
    venue_capability_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_targets_intent
    ON funding_targets(funding_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_targets_venue_status
    ON funding_targets(target_venue, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS funding_route_legs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_intent_id UUID NOT NULL REFERENCES funding_intents(id) ON DELETE CASCADE,
    funding_target_id UUID NOT NULL REFERENCES funding_targets(id) ON DELETE CASCADE,
    target_venue TEXT NOT NULL,
    source_chain TEXT NOT NULL,
    source_token TEXT NOT NULL,
    source_amount TEXT NOT NULL,
    destination_chain TEXT NOT NULL,
    destination_token TEXT NOT NULL,
    destination_amount_estimate TEXT NOT NULL,
    route_provider TEXT NOT NULL,
    route_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
    tx_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    bridge_status TEXT NOT NULL,
    destination_status TEXT NOT NULL,
    venue_credit_status TEXT NOT NULL,
    status TEXT NOT NULL,
    error_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_route_legs_intent
    ON funding_route_legs(funding_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_route_legs_status
    ON funding_route_legs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS funding_reconciliation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_intent_id UUID NOT NULL REFERENCES funding_intents(id) ON DELETE CASCADE,
    route_leg_id UUID NOT NULL REFERENCES funding_route_legs(id) ON DELETE CASCADE,
    target_venue TEXT NOT NULL,
    destination_tx_hash TEXT,
    destination_received BOOLEAN NOT NULL DEFAULT false,
    venue_credit_confirmed BOOLEAN NOT NULL DEFAULT false,
    ready_to_trade BOOLEAN NOT NULL DEFAULT false,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_funding_reconciliation_ready
    ON funding_reconciliation_records(target_venue, ready_to_trade, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_reconciliation_intent
    ON funding_reconciliation_records(funding_intent_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS funding_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_intent_id UUID NOT NULL REFERENCES funding_intents(id) ON DELETE CASCADE,
    route_leg_id UUID REFERENCES funding_route_legs(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_audit_events_intent
    ON funding_audit_events(funding_intent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_funding_audit_events_leg
    ON funding_audit_events(route_leg_id, created_at ASC);
