CREATE TABLE IF NOT EXISTS venue_orderbook_latest_snapshots (
  canonical_event_id TEXT NOT NULL,
  canonical_market_id TEXT NOT NULL,
  canonical_outcome_id TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  venue_market_id TEXT NOT NULL,
  venue_outcome_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_market_id, canonical_outcome_id, venue, venue_market_id, venue_outcome_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_latest_market_time
  ON venue_orderbook_latest_snapshots (canonical_market_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_latest_venue_market_time
  ON venue_orderbook_latest_snapshots (venue, venue_market_id, venue_outcome_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_venue_orderbook_latest_updated_at
  ON venue_orderbook_latest_snapshots (updated_at DESC);

INSERT INTO venue_orderbook_latest_snapshots (
  canonical_event_id,
  canonical_market_id,
  canonical_outcome_id,
  venue,
  venue_market_id,
  venue_outcome_id,
  source,
  quote_quality,
  source_timestamp,
  received_at,
  best_bid,
  best_ask,
  midpoint,
  spread,
  bid_depth,
  ask_depth,
  bids,
  asks,
  blockers,
  metadata_version,
  created_at,
  updated_at
)
SELECT DISTINCT ON (
       canonical_market_id,
       COALESCE(canonical_outcome_id, ''),
       venue,
       venue_market_id,
       COALESCE(venue_outcome_id, '')
     )
       canonical_event_id,
       canonical_market_id,
       COALESCE(canonical_outcome_id, '') AS canonical_outcome_id,
       venue,
       venue_market_id,
       COALESCE(venue_outcome_id, '') AS venue_outcome_id,
       source,
       quote_quality,
       source_timestamp,
       received_at,
       best_bid,
       best_ask,
       midpoint,
       spread,
       bid_depth,
       ask_depth,
       bids,
       asks,
       blockers,
       metadata_version,
       created_at,
       now() AS updated_at
  FROM venue_orderbook_snapshots
 ORDER BY canonical_market_id,
          COALESCE(canonical_outcome_id, ''),
          venue,
          venue_market_id,
          COALESCE(venue_outcome_id, ''),
          received_at DESC
ON CONFLICT (canonical_market_id, canonical_outcome_id, venue, venue_market_id, venue_outcome_id)
DO UPDATE SET
  canonical_event_id = EXCLUDED.canonical_event_id,
  source = EXCLUDED.source,
  quote_quality = EXCLUDED.quote_quality,
  source_timestamp = EXCLUDED.source_timestamp,
  received_at = EXCLUDED.received_at,
  best_bid = EXCLUDED.best_bid,
  best_ask = EXCLUDED.best_ask,
  midpoint = EXCLUDED.midpoint,
  spread = EXCLUDED.spread,
  bid_depth = EXCLUDED.bid_depth,
  ask_depth = EXCLUDED.ask_depth,
  bids = EXCLUDED.bids,
  asks = EXCLUDED.asks,
  blockers = EXCLUDED.blockers,
  metadata_version = EXCLUDED.metadata_version,
  updated_at = now()
WHERE EXCLUDED.received_at >= venue_orderbook_latest_snapshots.received_at;
