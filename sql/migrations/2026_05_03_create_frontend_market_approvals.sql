CREATE TABLE IF NOT EXISTS frontend_market_approvals (
  canonical_event_id uuid PRIMARY KEY REFERENCES canonical_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED', 'HIDDEN', 'DISABLED')),
  display_title text,
  sort_priority integer NOT NULL DEFAULT 1000,
  approved_by text NOT NULL,
  approval_reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frontend_market_approvals_status_priority
  ON frontend_market_approvals (status, sort_priority, approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_frontend_market_approvals_updated_at
  ON frontend_market_approvals (updated_at);
