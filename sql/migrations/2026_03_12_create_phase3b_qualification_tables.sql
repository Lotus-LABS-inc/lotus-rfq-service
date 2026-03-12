CREATE TABLE IF NOT EXISTS strategy_qualification_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_key TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    config_version TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS strategy_decision_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_run_id UUID NOT NULL REFERENCES strategy_qualification_runs(id) ON DELETE CASCADE,
    decision_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    replay_envelope_id UUID NULL REFERENCES replay_envelopes(id) ON DELETE SET NULL,
    realized_metrics JSONB NOT NULL,
    counterfactual_metrics JSONB NOT NULL,
    improvement_metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_promotion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_key TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS auto_safety_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_key TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_strategy_key
    ON strategy_qualification_runs(strategy_key);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_scope
    ON strategy_qualification_runs(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_stage
    ON strategy_qualification_runs(stage);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_status
    ON strategy_qualification_runs(status);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_started_at
    ON strategy_qualification_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_engine_version
    ON strategy_qualification_runs(engine_version);

CREATE INDEX IF NOT EXISTS idx_strategy_qualification_runs_config_version
    ON strategy_qualification_runs(config_version);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_evaluations_qualification_run_id
    ON strategy_decision_evaluations(qualification_run_id);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_evaluations_decision_type
    ON strategy_decision_evaluations(decision_type);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_evaluations_entity_id
    ON strategy_decision_evaluations(entity_id);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_evaluations_replay_envelope_id
    ON strategy_decision_evaluations(replay_envelope_id);

CREATE INDEX IF NOT EXISTS idx_strategy_decision_evaluations_created_at
    ON strategy_decision_evaluations(created_at);

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_strategy_key
    ON strategy_promotion_events(strategy_key);

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_scope
    ON strategy_promotion_events(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_created_at
    ON strategy_promotion_events(created_at);

CREATE INDEX IF NOT EXISTS idx_auto_safety_actions_strategy_key
    ON auto_safety_actions(strategy_key);

CREATE INDEX IF NOT EXISTS idx_auto_safety_actions_scope
    ON auto_safety_actions(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_auto_safety_actions_action_type
    ON auto_safety_actions(action_type);

CREATE INDEX IF NOT EXISTS idx_auto_safety_actions_resolved_at
    ON auto_safety_actions(resolved_at);

CREATE INDEX IF NOT EXISTS idx_auto_safety_actions_created_at
    ON auto_safety_actions(created_at);
