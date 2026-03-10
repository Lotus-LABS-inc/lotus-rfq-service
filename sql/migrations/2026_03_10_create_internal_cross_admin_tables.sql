CREATE TABLE IF NOT EXISTS internal_cross_admin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ORDER', 'TRADE')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_cross_admin_events_entity
  ON internal_cross_admin_events(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_cross_admin_events_correlation
  ON internal_cross_admin_events(correlation_id);

CREATE TABLE IF NOT EXISTS internal_cross_unwind_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  correlation_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'COMPLETED', 'FAILED')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_cross_unwind_tasks_trade
  ON internal_cross_unwind_tasks(trade_id, created_at DESC);
