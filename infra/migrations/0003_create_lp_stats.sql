CREATE TABLE IF NOT EXISTS lp_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_id TEXT NOT NULL UNIQUE,
  avg_response_time_ms NUMERIC(20, 6) NOT NULL DEFAULT 0,
  quote_hit_rate NUMERIC(10, 6) NOT NULL DEFAULT 0,
  reject_rate NUMERIC(10, 6) NOT NULL DEFAULT 0,
  execution_fail_rate NUMERIC(10, 6) NOT NULL DEFAULT 0,
  competitiveness_score NUMERIC(10, 6) NOT NULL DEFAULT 0,
  total_quotes BIGINT NOT NULL DEFAULT 0,
  total_executions BIGINT NOT NULL DEFAULT 0,
  successful_quotes BIGINT NOT NULL DEFAULT 0,
  rejected_quotes BIGINT NOT NULL DEFAULT 0,
  failed_executions BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lp_stats_lp_id ON lp_stats (lp_id);
CREATE INDEX IF NOT EXISTS idx_lp_stats_total_quotes ON lp_stats (total_quotes);
CREATE INDEX IF NOT EXISTS idx_lp_stats_total_executions ON lp_stats (total_executions);
