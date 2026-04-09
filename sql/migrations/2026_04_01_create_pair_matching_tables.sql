CREATE TABLE IF NOT EXISTS pair_matching_versions (
    id TEXT PRIMARY KEY,
    family_classifier_version TEXT NOT NULL,
    fingerprint_version TEXT NOT NULL,
    prefilter_version TEXT NOT NULL,
    structural_matcher_version TEXT NOT NULL,
    pair_classifier_version TEXT NOT NULL,
    embedding_model_version TEXT NOT NULL,
    review_policy_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matching_market_classifications (
    interpreted_contract_id TEXT PRIMARY KEY REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    family TEXT NOT NULL,
    family_confidence NUMERIC NOT NULL,
    classification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ambiguity_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    weak_structure_lane BOOLEAN NOT NULL DEFAULT false,
    classifier_version TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matching_structural_fingerprints (
    interpreted_contract_id TEXT PRIMARY KEY REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    fingerprint_hash TEXT NOT NULL,
    fingerprint JSONB NOT NULL,
    normalized_values JSONB NOT NULL,
    unresolved_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    fingerprint_version TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pair_edges (
    id TEXT PRIMARY KEY,
    canonical_event_id UUID NOT NULL,
    interpreted_contract_a_id TEXT NOT NULL REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    interpreted_contract_b_id TEXT NOT NULL REFERENCES interpreted_contracts(id) ON DELETE CASCADE,
    left_venue TEXT NOT NULL,
    right_venue TEXT NOT NULL,
    family TEXT NOT NULL,
    label TEXT NOT NULL,
    confidence_score NUMERIC NOT NULL,
    approval_state TEXT NOT NULL,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    temporal_basis TEXT NOT NULL,
    compatibility_decision_id TEXT NULL,
    compatibility_class TEXT NULL,
    matching_version_id TEXT NOT NULL REFERENCES pair_matching_versions(id) ON DELETE RESTRICT,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL,
    reviewed_by TEXT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    review_reason TEXT NULL,
    CONSTRAINT pair_edges_unique_pair UNIQUE (
        canonical_event_id,
        interpreted_contract_a_id,
        interpreted_contract_b_id,
        matching_version_id
    )
);

CREATE TABLE IF NOT EXISTS pair_edge_review_actions (
    id UUID PRIMARY KEY,
    pair_edge_id TEXT NOT NULL REFERENCES pair_edges(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    reason TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matching_market_classifications_family
    ON matching_market_classifications (family);

CREATE INDEX IF NOT EXISTS idx_matching_structural_fingerprints_hash
    ON matching_structural_fingerprints (fingerprint_hash);

CREATE INDEX IF NOT EXISTS idx_pair_edges_event_label
    ON pair_edges (canonical_event_id, label, approval_state);

CREATE INDEX IF NOT EXISTS idx_pair_edges_contracts
    ON pair_edges (interpreted_contract_a_id, interpreted_contract_b_id);

CREATE INDEX IF NOT EXISTS idx_pair_edge_review_actions_edge
    ON pair_edge_review_actions (pair_edge_id, created_at DESC);
