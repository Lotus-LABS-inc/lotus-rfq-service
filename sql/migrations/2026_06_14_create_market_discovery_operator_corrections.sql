CREATE TABLE IF NOT EXISTS market_discovery_operator_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target TEXT NOT NULL CHECK (target IN ('CANDIDATE', 'GROUP')),
  candidate_id UUID REFERENCES market_discovery_candidates(id) ON DELETE SET NULL,
  candidate_key TEXT,
  review_group_key TEXT,
  patch JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  corrected_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_market_discovery_operator_corrections_candidate_id
  ON market_discovery_operator_corrections(candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_market_discovery_operator_corrections_review_group_key
  ON market_discovery_operator_corrections(review_group_key)
  WHERE review_group_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_market_discovery_operator_corrections_active
  ON market_discovery_operator_corrections(target, created_at DESC)
  WHERE superseded_at IS NULL;
