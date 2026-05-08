ALTER TABLE signed_trade_bundle_executions
  ADD COLUMN IF NOT EXISTS selected_route JSONB;

CREATE TABLE IF NOT EXISTS signed_trade_bundle_position_applications (
  application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  leg_index INTEGER NOT NULL CHECK (leg_index >= 0),
  venue TEXT NOT NULL,
  venue_order_id TEXT NOT NULL,
  fill_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_signed_trade_position_application UNIQUE(execution_id, user_id, leg_index, venue_order_id)
);

CREATE INDEX IF NOT EXISTS idx_signed_trade_position_applications_user
  ON signed_trade_bundle_position_applications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signed_trade_position_applications_order
  ON signed_trade_bundle_position_applications(venue, venue_order_id);
