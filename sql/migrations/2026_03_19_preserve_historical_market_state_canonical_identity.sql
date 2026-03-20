DROP INDEX IF EXISTS idx_historical_market_states_identity_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_market_states_identity_unique
    ON historical_market_states (
        canonical_event_id,
        canonical_market_id,
        venue,
        venue_market_id,
        "timestamp",
        metadata_version
    );
