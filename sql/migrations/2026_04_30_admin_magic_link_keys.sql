ALTER TABLE admin_auth_keys
    ADD COLUMN IF NOT EXISTS key_type TEXT NOT NULL DEFAULT 'LOGIN_KEY';

ALTER TABLE admin_auth_keys
    DROP CONSTRAINT IF EXISTS admin_auth_keys_key_type_check;

ALTER TABLE admin_auth_keys
    ADD CONSTRAINT admin_auth_keys_key_type_check
        CHECK (key_type IN ('LOGIN_KEY', 'MAGIC_LINK'));

CREATE INDEX IF NOT EXISTS idx_admin_auth_keys_type_status_expires
    ON admin_auth_keys (key_type, status, expires_at);
