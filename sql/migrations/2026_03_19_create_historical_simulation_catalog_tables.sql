CREATE TABLE IF NOT EXISTS historical_simulation_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    canonical_event_id TEXT NOT NULL,
    canonical_market_id TEXT NOT NULL,
    canonical_category TEXT NOT NULL,
    oracle_type TEXT,
    oracle_name TEXT,
    resolution_authority_type TEXT,
    primary_resolution_text TEXT,
    supplemental_rules_text TEXT,
    dispute_window_hours NUMERIC,
    settlement_lag_hours NUMERIC,
    market_type TEXT,
    outcome_schema JSONB,
    has_ambiguous_time_boundary BOOLEAN NOT NULL DEFAULT false,
    has_ambiguous_jurisdiction_boundary BOOLEAN NOT NULL DEFAULT false,
    has_ambiguous_source_reference BOOLEAN NOT NULL DEFAULT false,
    historical_divergence_rate NUMERIC,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_historical_simulation_profile_identity
        UNIQUE (canonical_event_id, canonical_market_id, venue, venue_market_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_profiles_event_id
    ON historical_simulation_profiles(canonical_event_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_profiles_market_id
    ON historical_simulation_profiles(canonical_market_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_profiles_venue
    ON historical_simulation_profiles(venue);

CREATE TABLE IF NOT EXISTS historical_simulation_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_event_id TEXT NOT NULL,
    canonical_market_id TEXT NOT NULL,
    market_a_profile_id UUID NOT NULL REFERENCES historical_simulation_profiles(id) ON DELETE CASCADE,
    market_b_profile_id UUID NOT NULL REFERENCES historical_simulation_profiles(id) ON DELETE CASCADE,
    risk_score NUMERIC NOT NULL,
    confidence_score NUMERIC NOT NULL,
    equivalence_class TEXT NOT NULL,
    factor_breakdown JSONB NOT NULL,
    reasons JSONB NOT NULL,
    version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    liquidity_cost NUMERIC NULL,
    max_settlement_delay_hours NUMERIC NULL,
    CONSTRAINT ck_historical_simulation_assessment_distinct_profiles
        CHECK (market_a_profile_id <> market_b_profile_id),
    CONSTRAINT uq_historical_simulation_assessment_pair_version
        UNIQUE (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version)
);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_risk_event_id
    ON historical_simulation_risk_assessments(canonical_event_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_risk_market_id
    ON historical_simulation_risk_assessments(canonical_market_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_risk_market_a
    ON historical_simulation_risk_assessments(market_a_profile_id);

CREATE INDEX IF NOT EXISTS idx_historical_simulation_risk_market_b
    ON historical_simulation_risk_assessments(market_b_profile_id);
