ALTER TABLE historical_market_states
ADD COLUMN IF NOT EXISTS canonical_category TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_historical_market_states_category_event_venue_timestamp
ON historical_market_states(canonical_category, canonical_event_id, venue, "timestamp");
