CREATE TABLE IF NOT EXISTS predict_market_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NULL,
    categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    market_payload JSONB NOT NULL,
    source_metadata_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_market_metadata UNIQUE(environment, market_id, source_metadata_version)
);

CREATE INDEX IF NOT EXISTS idx_predict_market_metadata_environment_market
    ON predict_market_metadata(environment, market_id);

CREATE TABLE IF NOT EXISTS predict_orderbook_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ NULL,
    best_bid NUMERIC NULL,
    best_ask NUMERIC NULL,
    spread NUMERIC NULL,
    midpoint NUMERIC NULL,
    top_of_book_size NUMERIC NULL,
    snapshot_payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predict_orderbook_snapshots_env_market_timestamp
    ON predict_orderbook_snapshots(environment, market_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_predict_orderbook_snapshots_source_timestamp
    ON predict_orderbook_snapshots(source_timestamp);

CREATE TABLE IF NOT EXISTS predict_orderbook_deltas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    event_sequence BIGINT NOT NULL,
    delta_timestamp TIMESTAMPTZ NOT NULL,
    delta_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_orderbook_delta UNIQUE(environment, market_id, event_sequence)
);

CREATE INDEX IF NOT EXISTS idx_predict_orderbook_deltas_env_market_time
    ON predict_orderbook_deltas(environment, market_id, delta_timestamp);

CREATE TABLE IF NOT EXISTS predict_match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NULL,
    event_id TEXT NOT NULL,
    order_hash TEXT NULL,
    side TEXT NULL,
    price NUMERIC NULL,
    size NUMERIC NULL,
    event_timestamp TIMESTAMPTZ NULL,
    event_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_match_events_env_event UNIQUE(environment, event_id)
);

CREATE INDEX IF NOT EXISTS idx_predict_match_events_env_market_time
    ON predict_match_events(environment, market_id, event_timestamp);

CREATE INDEX IF NOT EXISTS idx_predict_match_events_order_hash
    ON predict_match_events(order_hash);

CREATE TABLE IF NOT EXISTS predict_recorder_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorder_type TEXT NOT NULL,
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    checkpoint_key TEXT NOT NULL,
    event_sequence BIGINT NOT NULL,
    checkpoint_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_recorder_checkpoint UNIQUE(recorder_type, checkpoint_key)
);

CREATE INDEX IF NOT EXISTS idx_predict_recorder_checkpoints_env_market
    ON predict_recorder_checkpoints(environment, market_id);

CREATE TABLE IF NOT EXISTS predict_fallback_historical_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    provenance TEXT NOT NULL,
    fidelity TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ NOT NULL,
    snapshot_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predict_fallback_snapshots_env_market_time
    ON predict_fallback_historical_snapshots(environment, market_id, source_timestamp);

CREATE INDEX IF NOT EXISTS idx_predict_fallback_snapshots_provenance
    ON predict_fallback_historical_snapshots(provenance);

CREATE TABLE IF NOT EXISTS predict_simulation_surface_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    precision TEXT NOT NULL,
    provenance TEXT NOT NULL,
    surface_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_surface_cache UNIQUE(environment, market_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_predict_surface_cache_env_market_window
    ON predict_simulation_surface_cache(environment, market_id, window_start, window_end);
