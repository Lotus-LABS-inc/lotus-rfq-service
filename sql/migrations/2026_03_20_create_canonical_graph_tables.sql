CREATE TABLE IF NOT EXISTS canonical_events (
    id UUID PRIMARY KEY,
    proposition_key TEXT NOT NULL,
    title TEXT NOT NULL,
    normalized_proposition_text TEXT NOT NULL,
    canonical_category TEXT NOT NULL,
    market_class TEXT NOT NULL,
    proposition_confidence_score NUMERIC NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    resolves_at TIMESTAMPTZ,
    source_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_events_proposition_key
    ON canonical_events(proposition_key);
CREATE INDEX IF NOT EXISTS idx_canonical_events_category_market_class
    ON canonical_events(canonical_category, market_class);

CREATE TABLE IF NOT EXISTS venue_market_profiles (
    id TEXT PRIMARY KEY,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    market_type TEXT,
    market_class TEXT NOT NULL,
    outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    outcome_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    canonical_category TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    resolves_at TIMESTAMPTZ,
    fees JSONB NOT NULL DEFAULT '{}'::jsonb,
    fee_model TEXT,
    resolution_source TEXT,
    resolution_title TEXT,
    resolution_rules_text TEXT,
    network TEXT,
    chain TEXT,
    raw_source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    mapping_lineage JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score NUMERIC NOT NULL DEFAULT 0,
    source_metadata_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_venue_market_profiles_venue_market UNIQUE (venue, venue_market_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_market_profiles_event_id
    ON venue_market_profiles(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_venue_market_profiles_venue
    ON venue_market_profiles(venue);
CREATE INDEX IF NOT EXISTS idx_venue_market_profiles_category_market_class
    ON venue_market_profiles(canonical_category, market_class);

CREATE TABLE IF NOT EXISTS proposition_fingerprints (
    id TEXT PRIMARY KEY,
    venue_market_profile_id TEXT NOT NULL UNIQUE REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    condition_text TEXT NOT NULL,
    time_boundary_text TEXT NOT NULL,
    market_class TEXT NOT NULL,
    normalized_outcome_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_proposition_text TEXT NOT NULL,
    grouping_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
    ambiguity_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score NUMERIC NOT NULL DEFAULT 0,
    broad_fingerprint_key TEXT NOT NULL,
    strict_fingerprint_key TEXT NOT NULL,
    fingerprint_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposition_fingerprints_broad_key
    ON proposition_fingerprints(broad_fingerprint_key);
CREATE INDEX IF NOT EXISTS idx_proposition_fingerprints_strict_key
    ON proposition_fingerprints(strict_fingerprint_key);
CREATE INDEX IF NOT EXISTS idx_proposition_fingerprints_hash
    ON proposition_fingerprints(fingerprint_hash);

CREATE TABLE IF NOT EXISTS venue_resolution_profiles (
    id TEXT PRIMARY KEY,
    venue_market_profile_id TEXT NOT NULL UNIQUE REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    resolution_source TEXT,
    resolution_title TEXT,
    normalized_resolution_authority_type TEXT,
    rule_text TEXT,
    source_hierarchy JSONB NOT NULL DEFAULT '{}'::jsonb,
    dispute_window_hours NUMERIC,
    ambiguous_time_boundary BOOLEAN NOT NULL DEFAULT false,
    ambiguous_source_reference BOOLEAN NOT NULL DEFAULT false,
    ambiguous_jurisdiction_or_scope BOOLEAN NOT NULL DEFAULT false,
    metadata_completeness_score NUMERIC NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venue_settlement_profiles (
    id TEXT PRIMARY KEY,
    venue_market_profile_id TEXT NOT NULL UNIQUE REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    settlement_type TEXT NOT NULL,
    settlement_lag_hours NUMERIC,
    dispute_window_hours NUMERIC,
    finality_lag_hours NUMERIC,
    payout_timing_hours NUMERIC,
    fee_on_entry BOOLEAN NOT NULL DEFAULT false,
    fee_on_exit BOOLEAN NOT NULL DEFAULT false,
    time_sensitive_fee_behavior TEXT,
    requires_conservative_anchor BOOLEAN NOT NULL DEFAULT false,
    metadata_completeness_score NUMERIC NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compatibility_edges (
    id TEXT PRIMARY KEY,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    market_a_profile_id TEXT NOT NULL REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    market_b_profile_id TEXT NOT NULL REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    compatibility_class TEXT NOT NULL,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    proposition_similarity_score NUMERIC NOT NULL,
    outcome_schema_compatibility_score NUMERIC NOT NULL,
    timing_compatibility_score NUMERIC NOT NULL,
    resolution_risk_score NUMERIC NOT NULL,
    settlement_risk_score NUMERIC NOT NULL,
    structure_risk_score NUMERIC NOT NULL,
    fee_compatibility_score NUMERIC NOT NULL,
    confidence_score NUMERIC NOT NULL,
    capital_lock_hours NUMERIC,
    max_settlement_delay_hours NUMERIC,
    liquidity_cost_model_version TEXT,
    liquidity_cost_bps NUMERIC,
    anchored_finality_hours NUMERIC,
    requires_conservative_settlement_anchor BOOLEAN NOT NULL DEFAULT false,
    factor_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    scoring_version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_compatibility_edges_distinct_profiles CHECK (market_a_profile_id <> market_b_profile_id),
    CONSTRAINT uq_compatibility_edges_pair_version UNIQUE (canonical_event_id, market_a_profile_id, market_b_profile_id, scoring_version)
);

CREATE INDEX IF NOT EXISTS idx_compatibility_edges_event_id
    ON compatibility_edges(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_edges_class
    ON compatibility_edges(compatibility_class);
CREATE INDEX IF NOT EXISTS idx_compatibility_edges_computed_at
    ON compatibility_edges(computed_at);

CREATE TABLE IF NOT EXISTS canonical_executable_markets (
    id TEXT PRIMARY KEY,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    market_class TEXT NOT NULL,
    compatibility_policy TEXT NOT NULL,
    risk_class TEXT NOT NULL,
    member_count INTEGER NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_executable_markets_event_id
    ON canonical_executable_markets(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_canonical_executable_markets_risk_class
    ON canonical_executable_markets(risk_class);

CREATE TABLE IF NOT EXISTS canonical_executable_market_members (
    canonical_executable_market_id TEXT NOT NULL REFERENCES canonical_executable_markets(id) ON DELETE CASCADE,
    venue_market_profile_id TEXT NOT NULL UNIQUE REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (canonical_executable_market_id, venue_market_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_executable_market_members_profile
    ON canonical_executable_market_members(venue_market_profile_id);
