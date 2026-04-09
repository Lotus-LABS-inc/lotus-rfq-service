CREATE TABLE IF NOT EXISTS pair_shadow_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_class text NOT NULL CHECK (route_class IN ('PAIR_PM_LIMITLESS', 'PAIR_PM_OPINION')),
  route_mode text NOT NULL CHECK (route_mode IN ('POLYMARKET_LIMITLESS', 'POLYMARKET_OPINION')),
  source_kind text NOT NULL CHECK (source_kind IN ('BOOTSTRAP_ARTIFACT', 'RUNTIME_OBSERVATION')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('SAFE_EXACT_SUBSET', 'SHADOW_ONLY_SUBSET', 'BLOCKED_FAMILY')),
  scope_key text NOT NULL,
  route_family text NOT NULL,
  canonical_event_id text NULL,
  canonical_market_id text NULL,
  basis_mode text NOT NULL CHECK (basis_mode IN ('HISTORICAL_ONLY', 'LIVE_ONLY', 'MIXED_BASIS_DIAGNOSTIC')),
  decision_timestamp timestamptz NOT NULL,
  candidate_venues text[] NOT NULL DEFAULT '{}',
  chosen_shadow_route text NULL,
  baseline_comparator text NULL,
  confidence_state text NOT NULL CHECK (confidence_state IN ('HIGH', 'MEDIUM', 'LOW')),
  compatibility_state text NOT NULL CHECK (compatibility_state IN ('EXACT', 'NEAR_EXACT', 'BLOCKED')),
  exactness_class text NOT NULL,
  expected_net_price numeric NULL,
  expected_effective_cost numeric NULL,
  expected_slippage numeric NULL,
  expected_fillability numeric NULL,
  blocked_reason text NULL,
  stale_data boolean NOT NULL DEFAULT false,
  mixed_basis boolean NOT NULL DEFAULT false,
  insufficient_basis boolean NOT NULL DEFAULT false,
  insufficient_evidence boolean NOT NULL DEFAULT false,
  live_data_clean boolean NOT NULL DEFAULT false,
  execution_boundary_healthy boolean NOT NULL DEFAULT true,
  venue_health_healthy boolean NOT NULL DEFAULT true,
  reproducibility_hash text NOT NULL,
  replay_envelope_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pair_shadow_observations_route_class
  ON pair_shadow_observations (route_class, decision_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_pair_shadow_observations_scope
  ON pair_shadow_observations (route_class, scope_kind, decision_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_pair_shadow_observations_reproducibility
  ON pair_shadow_observations (reproducibility_hash);

CREATE TABLE IF NOT EXISTS pair_promotion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_class text NOT NULL CHECK (route_class IN ('PAIR_PM_LIMITLESS', 'PAIR_PM_OPINION')),
  scope_promoted text NOT NULL,
  evidence_window_start timestamptz NOT NULL,
  evidence_window_end timestamptz NOT NULL,
  metrics_snapshot jsonb NOT NULL,
  thresholds_evaluated jsonb NOT NULL,
  pass boolean NOT NULL,
  operator_identity text NOT NULL,
  previous_rollout_state text NOT NULL,
  new_rollout_state text NOT NULL,
  rollback_reference text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pair_promotion_decisions_route_class
  ON pair_promotion_decisions (route_class, created_at DESC);

