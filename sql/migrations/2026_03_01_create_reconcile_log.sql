-- Log table for risk reconciliation discrepancies
CREATE TABLE risk_reconcile_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  canonical_market_id UUID NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  postgres_value NUMERIC NOT NULL,
  redis_value NUMERIC NOT NULL,
  diff NUMERIC NOT NULL,
  fixed BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_reconcile_user ON risk_reconcile_log(user_id);
CREATE INDEX idx_risk_reconcile_market ON risk_reconcile_log(canonical_market_id);
CREATE INDEX idx_risk_reconcile_time ON risk_reconcile_log(occurred_at);
