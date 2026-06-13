ALTER TABLE market_discovery_candidates
    DROP CONSTRAINT IF EXISTS market_discovery_candidates_state_check;

ALTER TABLE market_discovery_candidates
    ADD CONSTRAINT market_discovery_candidates_state_check
    CHECK (state IN ('DISCOVERED', 'INGESTED', 'APPROVED', 'REJECTED', 'SUPPRESSED'));

ALTER TABLE market_discovery_candidates
    ADD COLUMN IF NOT EXISTS candidate_type TEXT NOT NULL DEFAULT 'MERGE_SUGGESTION'
        CHECK (candidate_type IN ('NEW_DISCOVERY', 'MERGE_SUGGESTION', 'ENRICHMENT_ONLY', 'LOW_CONFIDENCE')),
    ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'EXISTING_INVENTORY'
        CHECK (source_kind IN ('UPSTREAM_VENUE', 'EXISTING_INVENTORY', 'MIXED')),
    ADD COLUMN IF NOT EXISTS novelty_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS draft_semantic_core JSONB,
    ADD COLUMN IF NOT EXISTS match_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS unsafe_grouping_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS approval_actions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE market_discovery_candidate_venue_profiles
    DROP CONSTRAINT IF EXISTS market_discovery_candidate_venue_profiles_venue_market_profile_id_fkey,
    DROP CONSTRAINT IF EXISTS market_discovery_candidate_venue_p_venue_market_profile_id_fkey,
    ALTER COLUMN canonical_event_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS venue_market_discovery_snapshots (
    id TEXT PRIMARY KEY,
    venue TEXT NOT NULL,
    venue_market_id TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    category TEXT NOT NULL,
    market_class TEXT NOT NULL,
    outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
    semantic_boundary_key TEXT,
    expires_at TIMESTAMPTZ,
    resolves_at TIMESTAMPTZ,
    rules_text TEXT,
    resolution_source TEXT,
    slug TEXT,
    source_url TEXT,
    token_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    quote_ready BOOLEAN NOT NULL DEFAULT false,
    execution_ready BOOLEAN NOT NULL DEFAULT false,
    source_hash TEXT NOT NULL,
    source_kind TEXT NOT NULL DEFAULT 'UPSTREAM_VENUE',
    raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue, venue_market_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_market_discovery_snapshots_active_category
    ON venue_market_discovery_snapshots(active, category, semantic_boundary_key);

CREATE INDEX IF NOT EXISTS idx_market_discovery_candidates_type_state
    ON market_discovery_candidates(candidate_type, state, updated_at DESC);
