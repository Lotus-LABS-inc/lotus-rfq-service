CREATE TABLE IF NOT EXISTS replay_envelopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    config_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    feature_flags JSONB NOT NULL,
    input_snapshot JSONB NOT NULL,
    decision_trace JSONB NOT NULL,
    output_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS replay_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    replay_envelope_id UUID NOT NULL REFERENCES replay_envelopes(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    result_status TEXT NOT NULL,
    diff_summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replay_envelopes_decision_type
    ON replay_envelopes(decision_type);

CREATE INDEX IF NOT EXISTS idx_replay_envelopes_entity_id
    ON replay_envelopes(entity_id);

CREATE INDEX IF NOT EXISTS idx_replay_envelopes_correlation_id
    ON replay_envelopes(correlation_id);

CREATE INDEX IF NOT EXISTS idx_replay_envelopes_created_at
    ON replay_envelopes(created_at);

CREATE INDEX IF NOT EXISTS idx_replay_runs_replay_envelope_id
    ON replay_runs(replay_envelope_id);

CREATE INDEX IF NOT EXISTS idx_replay_runs_mode
    ON replay_runs(mode);

CREATE INDEX IF NOT EXISTS idx_replay_runs_result_status
    ON replay_runs(result_status);

CREATE INDEX IF NOT EXISTS idx_replay_runs_created_at
    ON replay_runs(created_at);
