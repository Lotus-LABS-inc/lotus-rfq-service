-- combo_rfqs
CREATE TABLE combo_rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  acceptance_policy TEXT NOT NULL CHECK(acceptance_policy IN ('ALL_OR_NONE','BEST_EFFORT','PARTIAL_ALLOWED')),
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- combo_legs
CREATE TABLE combo_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_rfq_id UUID REFERENCES combo_rfqs(id) ON DELETE CASCADE,
  canonical_market_id UUID NOT NULL,
  canonical_outcome_id UUID NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  size NUMERIC NOT NULL,
  price_hint NUMERIC,
  metadata JSONB
);

CREATE INDEX idx_combo_legs_combo ON combo_legs(combo_rfq_id);

-- combo_quotes
CREATE TABLE combo_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_rfq_id UUID REFERENCES combo_rfqs(id) ON DELETE CASCADE,
  lp_id UUID NOT NULL,
  combo_price NUMERIC,            -- For whole-combo quotes
  per_leg_prices JSONB,           -- [{leg_id,price,size}]
  effective_cost NUMERIC,
  expires_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_combo_quotes_rfq ON combo_quotes(combo_rfq_id);

-- combo_executions
CREATE TABLE combo_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_rfq_id UUID REFERENCES combo_rfqs(id),
  combo_quote_id UUID REFERENCES combo_quotes(id),
  leg_id UUID,
  venue TEXT,
  connector_exec_id TEXT,
  status TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB
);
CREATE INDEX idx_combo_exec_combo ON combo_executions(combo_rfq_id);

-- combo_events (append-only)
CREATE TABLE combo_events (
  id BIGSERIAL PRIMARY KEY,
  combo_rfq_id UUID,
  event_type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
