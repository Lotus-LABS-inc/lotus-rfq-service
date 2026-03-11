CREATE TABLE IF NOT EXISTS resolution_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    canonical_event_id UUID NOT NULL,
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
    CONSTRAINT uq_resolution_profiles_venue_market UNIQUE (venue, venue_market_id)
);

CREATE INDEX IF NOT EXISTS idx_resolution_profiles_canonical_event_id
    ON resolution_profiles(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_resolution_profiles_venue
    ON resolution_profiles(venue);
CREATE INDEX IF NOT EXISTS idx_resolution_profiles_updated_at
    ON resolution_profiles(updated_at);

CREATE TABLE IF NOT EXISTS resolution_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_event_id UUID NOT NULL,
    market_a_profile_id UUID NOT NULL REFERENCES resolution_profiles(id) ON DELETE CASCADE,
    market_b_profile_id UUID NOT NULL REFERENCES resolution_profiles(id) ON DELETE CASCADE,
    risk_score NUMERIC NOT NULL,
    confidence_score NUMERIC NOT NULL,
    equivalence_class TEXT NOT NULL,
    factor_breakdown JSONB NOT NULL,
    reasons JSONB NOT NULL,
    version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_resolution_risk_assessment_distinct_profiles CHECK (market_a_profile_id <> market_b_profile_id),
    CONSTRAINT uq_resolution_risk_assessment_pair_version
        UNIQUE (canonical_event_id, market_a_profile_id, market_b_profile_id, version)
);

CREATE INDEX IF NOT EXISTS idx_resolution_risk_assessments_canonical_event_id
    ON resolution_risk_assessments(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_resolution_risk_assessments_market_a_profile_id
    ON resolution_risk_assessments(market_a_profile_id);
CREATE INDEX IF NOT EXISTS idx_resolution_risk_assessments_market_b_profile_id
    ON resolution_risk_assessments(market_b_profile_id);
CREATE INDEX IF NOT EXISTS idx_resolution_risk_assessments_equivalence_class
    ON resolution_risk_assessments(equivalence_class);
CREATE INDEX IF NOT EXISTS idx_resolution_risk_assessments_computed_at
    ON resolution_risk_assessments(computed_at);
