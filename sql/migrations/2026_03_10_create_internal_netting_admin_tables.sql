CREATE TABLE IF NOT EXISTS internal_netting_admin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_netting_admin_events_entity
  ON internal_netting_admin_events(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_netting_admin_events_correlation
  ON internal_netting_admin_events(correlation_id);

CREATE TABLE IF NOT EXISTS internal_netting_unwind_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_group_id UUID NOT NULL REFERENCES combo_netting_groups(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_netting_unwind_tasks_group
  ON internal_netting_unwind_tasks(netting_group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_netting_unwind_tasks_correlation
  ON internal_netting_unwind_tasks(correlation_id);
