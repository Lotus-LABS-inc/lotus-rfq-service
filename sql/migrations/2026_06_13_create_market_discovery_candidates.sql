CREATE TABLE IF NOT EXISTS market_discovery_candidates (
    id UUID PRIMARY KEY,
    candidate_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL
        CHECK (state IN ('DISCOVERED', 'INGESTED', 'APPROVED', 'REJECTED')),
    event_title TEXT NOT NULL,
    normalized_event_title TEXT NOT NULL,
    category TEXT NOT NULL,
    market_class TEXT NOT NULL,
    semantic_boundary_key TEXT,
    venue_count INTEGER NOT NULL DEFAULT 0,
    shared_outcome_count INTEGER NOT NULL DEFAULT 0,
    confidence_score NUMERIC NOT NULL DEFAULT 0,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    venues JSONB NOT NULL DEFAULT '[]'::jsonb,
    shared_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_canonical_event_id UUID REFERENCES canonical_events(id) ON DELETE SET NULL,
    reviewed_by TEXT,
    review_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_discovery_candidates_state
    ON market_discovery_candidates(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_discovery_candidates_category_boundary
    ON market_discovery_candidates(category, semantic_boundary_key);

CREATE TABLE IF NOT EXISTS market_discovery_candidate_venue_profiles (
    candidate_id UUID NOT NULL REFERENCES market_discovery_candidates(id) ON DELETE CASCADE,
    venue_market_profile_id TEXT NOT NULL REFERENCES venue_market_profiles(id) ON DELETE CASCADE,
    canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    canonical_market_id TEXT,
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    title TEXT NOT NULL,
    outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    quote_ready BOOLEAN NOT NULL DEFAULT false,
    execution_ready BOOLEAN NOT NULL DEFAULT false,
    evidence_label TEXT NOT NULL DEFAULT '',
    historical_row_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (candidate_id, venue_market_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_market_discovery_candidate_profiles_profile
    ON market_discovery_candidate_venue_profiles(venue_market_profile_id);
