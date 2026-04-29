CREATE INDEX IF NOT EXISTS idx_admin_members_created_by
    ON admin_members (created_by);

CREATE INDEX IF NOT EXISTS idx_admin_auth_keys_created_by
    ON admin_auth_keys (created_by);

CREATE INDEX IF NOT EXISTS idx_admin_auth_keys_revoked_by
    ON admin_auth_keys (revoked_by);
