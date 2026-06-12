-- Persists operator review decisions on cross-venue near-exact matches so a rejected
-- pair stays rejected across pipeline re-runs. Keyed by the matcher's stable matchId
-- (semmatch_<hash> of the venue pair), so re-running the matcher re-applies the decision.
CREATE TABLE IF NOT EXISTS market_matching_review_decisions (
  match_id text PRIMARY KEY,
  decision text NOT NULL DEFAULT 'REJECTED'
    CHECK (decision IN ('REJECTED')),
  event_title text,
  seed_venue text,
  seed_venue_market_id text,
  candidate_venue text,
  candidate_venue_market_id text,
  reason text NOT NULL,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_matching_review_decisions_decision
  ON market_matching_review_decisions (decision, decided_at DESC);
