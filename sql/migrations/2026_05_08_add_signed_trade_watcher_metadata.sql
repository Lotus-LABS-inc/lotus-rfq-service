ALTER TABLE signed_trade_bundle_executions
  ADD COLUMN IF NOT EXISTS watcher_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_signed_trade_bundle_executions_active_watcher
  ON signed_trade_bundle_executions(status, updated_at DESC)
  WHERE dry_run = false AND status IN ('SUBMITTED', 'PARTIAL', 'FILLED');
