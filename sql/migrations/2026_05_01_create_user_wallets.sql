CREATE TABLE IF NOT EXISTS user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_sub_org_id TEXT,
    provider_wallet_id TEXT,
    provider_wallet_account_id TEXT,
    chain_family TEXT NOT NULL,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    purpose TEXT NOT NULL,
    venue TEXT,
    exportable BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user
    ON user_wallets(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_purpose
    ON user_wallets(user_id, chain_family, purpose, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_provider_account
    ON user_wallets(provider, provider_wallet_account_id)
    WHERE provider_wallet_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_active_scope
    ON user_wallets(user_id, chain_family, purpose, COALESCE(venue, ''))
    WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS user_wallet_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    wallet_id UUID REFERENCES user_wallets(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_wallet_audit_events_user
    ON user_wallet_audit_events(user_id, created_at DESC);

INSERT INTO user_wallets (
    user_id,
    provider,
    chain_family,
    chain,
    address,
    purpose,
    exportable,
    status,
    created_at,
    updated_at
)
SELECT user_id,
       'EXTERNAL',
       chain_family,
       chain_family,
       address,
       'WITHDRAWAL_DESTINATION',
       true,
       'ACTIVE',
       created_at,
       updated_at
  FROM user_withdrawal_wallets
ON CONFLICT DO NOTHING;

ALTER TABLE funding_intents
    ADD COLUMN IF NOT EXISTS source_wallet_id UUID REFERENCES user_wallets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_funding_intents_source_wallet
    ON funding_intents(source_wallet_id)
    WHERE source_wallet_id IS NOT NULL;
