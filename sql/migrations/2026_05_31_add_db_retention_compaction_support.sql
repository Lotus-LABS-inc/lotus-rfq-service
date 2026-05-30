CREATE TABLE IF NOT EXISTS venue_orderbook_snapshot_hourly_compactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id TEXT NOT NULL,
  canonical_market_id TEXT NOT NULL,
  canonical_outcome_id TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  venue_market_id TEXT NOT NULL,
  venue_outcome_id TEXT NOT NULL DEFAULT '',
  bucket_start TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL,
  first_received_at TIMESTAMPTZ NOT NULL,
  last_received_at TIMESTAMPTZ NOT NULL,
  avg_midpoint NUMERIC,
  avg_best_bid NUMERIC,
  avg_best_ask NUMERIC,
  last_midpoint NUMERIC,
  last_best_bid NUMERIC,
  last_best_ask NUMERIC,
  max_bid_depth NUMERIC NOT NULL DEFAULT 0,
  max_ask_depth NUMERIC NOT NULL DEFAULT 0,
  blocker_count INTEGER NOT NULL DEFAULT 0,
  metadata_version TEXT NOT NULL DEFAULT 'venue-orderbook-hourly-compaction-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (
    canonical_market_id,
    canonical_outcome_id,
    venue,
    venue_market_id,
    venue_outcome_id,
    bucket_start
  )
);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_hourly_market_outcome_time
  ON venue_orderbook_snapshot_hourly_compactions (canonical_market_id, canonical_outcome_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_hourly_event_time
  ON venue_orderbook_snapshot_hourly_compactions (canonical_event_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_hourly_venue_market_time
  ON venue_orderbook_snapshot_hourly_compactions (venue, venue_market_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_snapshots_retention_received
  ON venue_orderbook_snapshots (received_at, created_at);

CREATE INDEX IF NOT EXISTS idx_funding_audit_events_retention
  ON funding_audit_events (created_at DESC, event_type);

CREATE INDEX IF NOT EXISTS idx_funding_audit_events_exact_coalesce
  ON funding_audit_events (
    funding_intent_id,
    route_leg_id,
    event_type,
    md5(payload::text),
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_funding_reconciliation_records_retention
  ON funding_reconciliation_records (checked_at DESC, ready_to_trade);
