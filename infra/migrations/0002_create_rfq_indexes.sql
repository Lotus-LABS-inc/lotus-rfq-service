BEGIN;

CREATE INDEX IF NOT EXISTS idx_rfq_sessions_market_status
  ON rfq_sessions (canonical_market_id, status);

CREATE INDEX IF NOT EXISTS idx_rfq_sessions_taker_created
  ON rfq_sessions (taker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_sessions_expires_at
  ON rfq_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_session_created
  ON rfq_quotes (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_lp_status
  ON rfq_quotes (lp_key_id, quote_status);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_valid_until
  ON rfq_quotes (valid_until);

CREATE INDEX IF NOT EXISTS idx_rfq_events_session_created
  ON rfq_events (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_events_quote_created
  ON rfq_events (quote_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_executions_session_created
  ON rfq_executions (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfq_executions_quote_status
  ON rfq_executions (quote_id, execution_status);

CREATE INDEX IF NOT EXISTS idx_lp_keys_lp_status
  ON lp_keys (lp_id, status);

COMMIT;
