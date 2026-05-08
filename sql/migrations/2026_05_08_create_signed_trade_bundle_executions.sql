CREATE TABLE IF NOT EXISTS signed_trade_bundle_executions (
  execution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRY_RUN_VERIFIED', 'SUBMITTED', 'PARTIAL', 'FILLED', 'FAILED')),
  dry_run BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  submitted_legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signed_trade_bundle_executions_user_updated
  ON signed_trade_bundle_executions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signed_trade_bundle_executions_status
  ON signed_trade_bundle_executions(status, updated_at DESC);
