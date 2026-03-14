CREATE TABLE IF NOT EXISTS historical_market_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_event_id TEXT NOT NULL,
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    market_class TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    midpoint NUMERIC NULL,
    best_bid NUMERIC NULL,
    best_ask NUMERIC NULL,
    spread NUMERIC NULL,
    last_price NUMERIC NULL,
    volume NUMERIC NULL,
    open_interest NUMERIC NULL,
    candles JSONB NULL,
    orderbook_snapshot JSONB NULL,
    market_events JSONB NULL,
    trades JSONB NULL,
    own_execution_history JSONB NULL,
    metadata_version TEXT NOT NULL,
    source_timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_simulation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    venue_pair TEXT NOT NULL,
    market_class TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS historical_simulation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES historical_simulation_runs(id) ON DELETE CASCADE,
    canonical_event_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    baseline_results JSONB NOT NULL,
    lotus_result JSONB NOT NULL,
    improvement JSONB NOT NULL,
    rollout_eligibility JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historical_market_states_canonical_event_id
    ON historical_market_states(canonical_event_id);

CREATE INDEX IF NOT EXISTS idx_historical_market_states_venue
    ON historical_market_states(venue);

CREATE INDEX IF NOT EXISTS idx_historical_market_states_venue_market_id
    ON historical_market_states(venue_market_id);

CREATE INDEX IF NOT EXISTS idx_historical_market_states_timestamp
    ON historical_market_states(timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_market_states_venue_market_timestamp
    ON historical_market_states(venue, venue_market_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_scope
    ON historical_simulation_runs(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_venue_pair
    ON historical_simulation_runs(venue_pair);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_market_class
    ON historical_simulation_runs(market_class);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_status
    ON historical_simulation_runs(status);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_started_at
    ON historical_simulation_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_results_run_id
    ON historical_simulation_results(run_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_results_canonical_event_id
    ON historical_simulation_results(canonical_event_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_results_timestamp
    ON historical_simulation_results(timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_results_created_at
    ON historical_simulation_results(created_at);
