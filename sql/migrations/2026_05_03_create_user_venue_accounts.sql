CREATE TABLE IF NOT EXISTS user_venue_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    user_wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE RESTRICT,
    wallet_address TEXT NOT NULL,
    venue_account_id TEXT,
    venue_account_address TEXT,
    venue_account_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_verified_at TIMESTAMPTZ,
    CONSTRAINT chk_user_venue_accounts_type
      CHECK (venue_account_type IN ('SAFE', 'SMART_WALLET', 'OAUTH_ACCOUNT', 'EOA', 'PROXY_ACCOUNT')),
    CONSTRAINT chk_user_venue_accounts_status
      CHECK (status IN ('PENDING', 'ACTIVE', 'DISABLED', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_venue_accounts_active_scope
    ON user_venue_accounts(user_id, venue)
    WHERE status IN ('PENDING', 'ACTIVE');

CREATE INDEX IF NOT EXISTS idx_user_venue_accounts_wallet
    ON user_venue_accounts(user_wallet_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_venue_accounts_venue_status
    ON user_venue_accounts(venue, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_venue_account_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    venue_account_id UUID REFERENCES user_venue_accounts(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_venue_account_audit_events_user
    ON user_venue_account_audit_events(user_id, created_at DESC);
