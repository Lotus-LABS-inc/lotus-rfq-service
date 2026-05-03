ALTER TABLE user_venue_accounts
  DROP CONSTRAINT IF EXISTS chk_user_venue_accounts_type;

ALTER TABLE user_venue_accounts
  ADD CONSTRAINT chk_user_venue_accounts_type
  CHECK (venue_account_type IN ('SAFE', 'SMART_WALLET', 'OAUTH_ACCOUNT', 'EOA', 'PROXY_ACCOUNT', 'DEPOSIT_WALLET'));
