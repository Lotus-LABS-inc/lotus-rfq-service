CREATE TABLE IF NOT EXISTS predict_fallback_coverage_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment TEXT NOT NULL,
    market_id TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    snapshot_count INTEGER NOT NULL,
    first_snapshot_at TIMESTAMPTZ NULL,
    last_snapshot_at TIMESTAMPTZ NULL,
    scan_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_predict_fallback_coverage_scans UNIQUE(environment, market_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_predict_fallback_coverage_scans_env_market_window
    ON predict_fallback_coverage_scans(environment, market_id, window_start, window_end);

CREATE INDEX IF NOT EXISTS idx_predict_fallback_coverage_scans_snapshot_count
    ON predict_fallback_coverage_scans(snapshot_count);
