CREATE TABLE IF NOT EXISTS user_withdrawal_wallets (
    user_id TEXT NOT NULL,
    chain_family TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, chain_family)
);

CREATE INDEX IF NOT EXISTS idx_user_withdrawal_wallets_user
    ON user_withdrawal_wallets(user_id, updated_at DESC);
