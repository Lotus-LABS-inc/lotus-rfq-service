CREATE TABLE IF NOT EXISTS admin_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    display_name TEXT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_by UUID NULL REFERENCES admin_members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_members_email_lower
    ON admin_members (lower(email));

CREATE INDEX IF NOT EXISTS idx_admin_members_status_role
    ON admin_members (status, role);

CREATE TABLE IF NOT EXISTS admin_auth_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_member_id UUID NOT NULL REFERENCES admin_members(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    last_used_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    created_by UUID NULL REFERENCES admin_members(id) ON DELETE SET NULL,
    revoked_by UUID NULL REFERENCES admin_members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_auth_keys_member
    ON admin_auth_keys (admin_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_auth_keys_status
    ON admin_auth_keys (status, expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_admin_member_id UUID NULL REFERENCES admin_members(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    target_type TEXT NULL,
    target_id TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_actor_created_at
    ON admin_audit_events (actor_admin_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target_created_at
    ON admin_audit_events (target_type, target_id, created_at DESC);
