CREATE TABLE IF NOT EXISTS control_plane_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    engine TEXT NULL,
    previous_mode TEXT NULL,
    new_mode TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_events_scope_created_at
    ON control_plane_audit_events(scope_type, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_events_event_type
    ON control_plane_audit_events(event_type);

CREATE INDEX IF NOT EXISTS idx_control_plane_audit_events_created_at
    ON control_plane_audit_events(created_at);
