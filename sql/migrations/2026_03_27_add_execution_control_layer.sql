CREATE TABLE IF NOT EXISTS execution_control_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID REFERENCES execution_intents(id) ON DELETE SET NULL,
    execution_record_id UUID REFERENCES execution_records(id) ON DELETE SET NULL,
    route_plan_id UUID,
    route_selection_trace_id UUID REFERENCES route_selection_traces(id) ON DELETE SET NULL,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    canonical_executable_market_id TEXT NOT NULL,
    user_wallet_ref TEXT,
    compatibility_decision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    compatibility_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key TEXT NOT NULL,
    allowed BOOLEAN NOT NULL,
    block_reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    warning_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    freshness_status TEXT NOT NULL,
    policy_status TEXT NOT NULL,
    approval_status TEXT NOT NULL,
    idempotency_status TEXT NOT NULL,
    replay_protection_status TEXT NOT NULL,
    next_action TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_control_decisions_route_plan_id
    ON execution_control_decisions(route_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_decisions_execution_intent_id
    ON execution_control_decisions(execution_intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_decisions_execution_record_id
    ON execution_control_decisions(execution_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_decisions_idempotency_key
    ON execution_control_decisions(idempotency_key, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_approval_states (
    execution_intent_id UUID PRIMARY KEY REFERENCES execution_intents(id) ON DELETE CASCADE,
    approval_status TEXT NOT NULL,
    approval_binding_hash TEXT,
    approval_granted_at TIMESTAMPTZ,
    approval_actor_ref TEXT,
    approval_context_version TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_approval_states_binding_hash
    ON execution_approval_states(approval_binding_hash);

CREATE TABLE IF NOT EXISTS execution_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    execution_intent_id UUID REFERENCES execution_intents(id) ON DELETE SET NULL,
    route_plan_id UUID,
    principal_id TEXT NOT NULL,
    wallet_ref TEXT,
    venue_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    requested_action TEXT NOT NULL,
    binding_hash TEXT NOT NULL,
    last_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_idempotency_keys_route_plan_id
    ON execution_idempotency_keys(route_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_idempotency_keys_execution_intent_id
    ON execution_idempotency_keys(execution_intent_id);
CREATE INDEX IF NOT EXISTS idx_execution_idempotency_keys_binding_hash
    ON execution_idempotency_keys(binding_hash);

CREATE TABLE IF NOT EXISTS execution_replay_protection_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID REFERENCES execution_intents(id) ON DELETE SET NULL,
    execution_record_id UUID REFERENCES execution_records(id) ON DELETE SET NULL,
    route_plan_id UUID,
    idempotency_key TEXT NOT NULL,
    approval_binding_hash TEXT,
    provider_execution_key TEXT,
    protection_status TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_replay_protection_route_plan_id
    ON execution_replay_protection_records(route_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_replay_protection_execution_intent_id
    ON execution_replay_protection_records(execution_intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_replay_protection_execution_record_id
    ON execution_replay_protection_records(execution_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_replay_protection_idempotency_key
    ON execution_replay_protection_records(idempotency_key, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_submission_lineage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID NOT NULL REFERENCES execution_intents(id) ON DELETE CASCADE,
    execution_record_id UUID NOT NULL REFERENCES execution_records(id) ON DELETE CASCADE,
    route_plan_id UUID,
    submission_kind TEXT NOT NULL,
    provider_execution_key TEXT,
    lineage_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_submission_lineage_route_plan_id
    ON execution_submission_lineage(route_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_submission_lineage_execution_intent_id
    ON execution_submission_lineage(execution_intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_submission_lineage_execution_record_id
    ON execution_submission_lineage(execution_record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_control_audit_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID REFERENCES execution_intents(id) ON DELETE SET NULL,
    execution_record_id UUID REFERENCES execution_records(id) ON DELETE SET NULL,
    route_plan_id UUID,
    idempotency_key TEXT,
    event_type TEXT NOT NULL,
    actor_identity TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_control_audit_records_route_plan_id
    ON execution_control_audit_records(route_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_audit_records_execution_intent_id
    ON execution_control_audit_records(execution_intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_audit_records_execution_record_id
    ON execution_control_audit_records(execution_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_control_audit_records_idempotency_key
    ON execution_control_audit_records(idempotency_key, created_at DESC);
