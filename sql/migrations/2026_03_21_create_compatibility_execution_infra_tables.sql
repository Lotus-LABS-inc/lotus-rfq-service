CREATE TABLE IF NOT EXISTS interpreted_contracts (
    id TEXT PRIMARY KEY,
    venue_market_profile_id TEXT NOT NULL UNIQUE REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    proposition_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcome_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
    timing_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
    settlement_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
    ambiguity_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    interpretation_confidence NUMERIC NOT NULL DEFAULT 0,
    source_metadata_version TEXT NOT NULL,
    raw_lineage_references JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_poolable BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interpreted_contracts_event_id
    ON interpreted_contracts(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_interpreted_contracts_venue
    ON interpreted_contracts(venue);
CREATE INDEX IF NOT EXISTS idx_interpreted_contracts_poolable
    ON interpreted_contracts(is_poolable);

CREATE TABLE IF NOT EXISTS compatibility_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scoring_version TEXT NOT NULL,
    ruleset_version TEXT NOT NULL,
    model_version TEXT NOT NULL,
    override_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compatibility_versions_unique
    ON compatibility_versions (scoring_version, ruleset_version, model_version, COALESCE(override_version, ''));

CREATE TABLE IF NOT EXISTS compatibility_decisions (
    id TEXT PRIMARY KEY,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    interpreted_contract_a_id TEXT NOT NULL REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    interpreted_contract_b_id TEXT NOT NULL REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    compatibility_version_id UUID NOT NULL REFERENCES compatibility_versions(id) ON DELETE RESTRICT,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    compatibility_class TEXT NOT NULL,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    hard_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
    caution_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    soft_penalties JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score NUMERIC NOT NULL,
    factor_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    supporting_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    reviewer_override_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_compatibility_decisions_distinct_contracts CHECK (interpreted_contract_a_id <> interpreted_contract_b_id),
    CONSTRAINT uq_compatibility_decisions_pair_version UNIQUE (
        canonical_event_id,
        interpreted_contract_a_id,
        interpreted_contract_b_id,
        compatibility_version_id
    )
);

CREATE INDEX IF NOT EXISTS idx_compatibility_decisions_event_id
    ON compatibility_decisions(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_decisions_class
    ON compatibility_decisions(compatibility_class);
CREATE INDEX IF NOT EXISTS idx_compatibility_decisions_version
    ON compatibility_decisions(compatibility_version_id);

CREATE TABLE IF NOT EXISTS compatibility_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_decision_id TEXT NOT NULL REFERENCES compatibility_decisions(id) ON DELETE CASCADE,
    forced_compatibility_class TEXT NOT NULL,
    reviewer_identity TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    override_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compatibility_overrides_target_decision
    ON compatibility_overrides(target_decision_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compatibility_overrides_expires_at
    ON compatibility_overrides(expires_at);

CREATE TABLE IF NOT EXISTS compatibility_override_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_id UUID NOT NULL REFERENCES compatibility_overrides(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor_identity TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compatibility_override_audit_events_override_id
    ON compatibility_override_audit_events(override_id, created_at DESC);

CREATE TABLE IF NOT EXISTS route_selection_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id UUID NOT NULL,
    route_plan_id UUID,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    selected_candidate_id UUID,
    selected_route_rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
    candidate_ordering JSONB NOT NULL DEFAULT '[]'::jsonb,
    compatibility_decision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_selection_traces_rfq_id
    ON route_selection_traces(rfq_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_selection_traces_route_plan_id
    ON route_selection_traces(route_plan_id);

CREATE TABLE IF NOT EXISTS route_candidate_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_selection_trace_id UUID NOT NULL REFERENCES route_selection_traces(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL,
    candidate_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    feasibility_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_candidate_sets_trace_id
    ON route_candidate_sets(route_selection_trace_id);

CREATE TABLE IF NOT EXISTS route_rejection_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_selection_trace_id UUID NOT NULL REFERENCES route_selection_traces(id) ON DELETE CASCADE,
    candidate_id UUID,
    reason_code TEXT NOT NULL,
    reason_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_rejection_reasons_trace_id
    ON route_rejection_reasons(route_selection_trace_id);

CREATE TABLE IF NOT EXISTS execution_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key TEXT NOT NULL UNIQUE,
    route_plan_id UUID,
    route_selection_trace_id UUID REFERENCES route_selection_traces(id) ON DELETE SET NULL,
    initiating_principal TEXT NOT NULL,
    requested_action TEXT NOT NULL,
    requested_notional NUMERIC,
    requested_size NUMERIC,
    route_type TEXT NOT NULL,
    approval_state TEXT NOT NULL,
    intended_venues JSONB NOT NULL DEFAULT '[]'::jsonb,
    compatibility_decision_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_intents_route_plan_id
    ON execution_intents(route_plan_id);
CREATE INDEX IF NOT EXISTS idx_execution_intents_created_at
    ON execution_intents(created_at DESC);

CREATE TABLE IF NOT EXISTS execution_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID NOT NULL REFERENCES execution_intents(id) ON DELETE CASCADE,
    venue TEXT NOT NULL,
    venue_execution_ref TEXT,
    execution_state TEXT NOT NULL,
    sync_status TEXT NOT NULL,
    settlement_status TEXT NOT NULL,
    fill_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    retry_lineage JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_execution_key TEXT,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue, provider_execution_key)
);

CREATE INDEX IF NOT EXISTS idx_execution_records_intent_id
    ON execution_records(execution_intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_record_id UUID NOT NULL REFERENCES execution_records(id) ON DELETE CASCADE,
    from_state TEXT,
    to_state TEXT NOT NULL,
    transition_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_state_transitions_record_id
    ON execution_state_transitions(execution_record_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS execution_recovery_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_intent_id UUID REFERENCES execution_intents(id) ON DELETE CASCADE,
    execution_record_id UUID REFERENCES execution_records(id) ON DELETE CASCADE,
    policy_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_status TEXT NOT NULL,
    rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
    replay_envelope_id UUID REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_recovery_actions_intent_id
    ON execution_recovery_actions(execution_intent_id, created_at DESC);
