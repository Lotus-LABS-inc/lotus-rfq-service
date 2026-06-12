BEGIN;

ALTER TABLE rfq_sessions
  ADD COLUMN IF NOT EXISTS flow_segment TEXT CHECK (flow_segment IN ('soft', 'standard')),
  ADD COLUMN IF NOT EXISTS flow_segment_version TEXT,
  ADD COLUMN IF NOT EXISTS flow_segment_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS flow_segment_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rfq_sessions_flow_segment_status
  ON rfq_sessions (flow_segment, status);

COMMIT;
