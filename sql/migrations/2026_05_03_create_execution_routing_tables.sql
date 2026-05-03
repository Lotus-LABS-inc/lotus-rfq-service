CREATE TABLE IF NOT EXISTS execution_route_quotes (
  quote_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  market_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  selected_route JSONB NOT NULL,
  rejected_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_route_quotes_user_market
  ON execution_route_quotes(user_id, market_id, outcome_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_route_quotes_expires_at
  ON execution_route_quotes(expires_at);

CREATE TABLE IF NOT EXISTS user_execution_positions (
  position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  market_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  venue_account_address TEXT,
  verified_size NUMERIC NOT NULL DEFAULT 0 CHECK (verified_size >= 0),
  average_entry_price NUMERIC NOT NULL DEFAULT 0 CHECK (average_entry_price >= 0),
  sellable_size NUMERIC NOT NULL DEFAULT 0 CHECK (sellable_size >= 0),
  last_settlement_evidence_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED', 'PENDING', 'RECOVERY', 'DISABLED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_execution_positions UNIQUE(user_id, venue, market_id, outcome_id)
);

CREATE INDEX IF NOT EXISTS idx_user_execution_positions_user_market
  ON user_execution_positions(user_id, market_id, outcome_id, status);

CREATE INDEX IF NOT EXISTS idx_user_execution_positions_venue
  ON user_execution_positions(venue, status);

CREATE TABLE IF NOT EXISTS execution_recovery_cases (
  case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  execution_leg_id TEXT,
  venue TEXT NOT NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('MATCHED', 'MISSING', 'MISMATCHED', 'AMBIGUOUS')),
  recovery_action TEXT NOT NULL CHECK (recovery_action IN (
    'AUTO_RETRY_STATUS',
    'AUTO_WAIT_FOR_FINALITY',
    'AUTO_REFUND',
    'AUTO_REROUTE',
    'MANUAL_REVIEW',
    'NO_ACTION_SAFE_PENDING'
  )),
  recovery_status TEXT NOT NULL CHECK (recovery_status IN (
    'RECOVERY_CLASSIFYING',
    'RECOVERY_WAITING_FINALITY',
    'RECOVERY_RETRYING_STATUS',
    'RECOVERY_REROUTING',
    'RECOVERY_REFUNDING',
    'RECOVERY_MANUAL_REVIEW',
    'RECOVERY_RESOLVED',
    'RECOVERY_FAILED_CLOSED'
  )),
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_execution_recovery_cases UNIQUE(execution_id, execution_leg_id, venue)
);

CREATE INDEX IF NOT EXISTS idx_execution_recovery_cases_user_status
  ON execution_recovery_cases(user_id, recovery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_recovery_cases_execution
  ON execution_recovery_cases(execution_id, created_at DESC);
