CREATE TABLE IF NOT EXISTS control_plane_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    override_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS planner_shard_state (
    shard_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    active_plans INT NOT NULL,
    active_buckets INT NOT NULL,
    stale_reservations INT NOT NULL,
    avg_planner_latency_ms NUMERIC NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bucket_state (
    bucket_id TEXT PRIMARY KEY,
    bucket_type TEXT NOT NULL,
    mode TEXT NOT NULL,
    entity_count INT NOT NULL,
    graph_density NUMERIC NULL,
    degradation_reason TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_overrides_scope
    ON control_plane_overrides(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_control_plane_overrides_override_type
    ON control_plane_overrides(override_type);

CREATE INDEX IF NOT EXISTS idx_control_plane_overrides_created_at
    ON control_plane_overrides(created_at);

CREATE INDEX IF NOT EXISTS idx_control_plane_overrides_expires_at
    ON control_plane_overrides(expires_at);

CREATE INDEX IF NOT EXISTS idx_planner_shard_state_mode
    ON planner_shard_state(mode);

CREATE INDEX IF NOT EXISTS idx_planner_shard_state_updated_at
    ON planner_shard_state(updated_at);

CREATE INDEX IF NOT EXISTS idx_bucket_state_bucket_type
    ON bucket_state(bucket_type);

CREATE INDEX IF NOT EXISTS idx_bucket_state_mode
    ON bucket_state(mode);

CREATE INDEX IF NOT EXISTS idx_bucket_state_updated_at
    ON bucket_state(updated_at);
