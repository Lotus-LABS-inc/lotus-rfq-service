CREATE TABLE IF NOT EXISTS venue_orderbook_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id TEXT NOT NULL,
  canonical_market_id TEXT NOT NULL,
  canonical_outcome_id TEXT,
  venue TEXT NOT NULL,
  venue_market_id TEXT NOT NULL,
  venue_outcome_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('STREAM', 'REST')),
  quote_quality TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL,
  best_bid NUMERIC,
  best_ask NUMERIC,
  midpoint NUMERIC,
  spread NUMERIC,
  bid_depth NUMERIC NOT NULL DEFAULT 0,
  ask_depth NUMERIC NOT NULL DEFAULT 0,
  bids JSONB NOT NULL DEFAULT '[]'::jsonb,
  asks JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_version TEXT NOT NULL DEFAULT 'venue-orderbook-recorder-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_snapshots_market_outcome_time
  ON venue_orderbook_snapshots (canonical_market_id, canonical_outcome_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_snapshots_event_time
  ON venue_orderbook_snapshots (canonical_event_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_snapshots_venue_market_time
  ON venue_orderbook_snapshots (venue, venue_market_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_snapshots_created_at
  ON venue_orderbook_snapshots (created_at);
