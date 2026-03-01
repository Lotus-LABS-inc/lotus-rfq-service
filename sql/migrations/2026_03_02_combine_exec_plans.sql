-- combo_execution_plans
CREATE TABLE combo_execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_rfq_id UUID REFERENCES combo_rfqs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reservation_token TEXT NOT NULL,
  total_cost_basis NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX idx_combo_ex_plans_rfq ON combo_execution_plans(combo_rfq_id);

-- combo_execution_steps
CREATE TABLE combo_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES combo_execution_plans(id) ON DELETE CASCADE,
  leg_id UUID REFERENCES combo_legs(id) ON DELETE CASCADE,
  lp_id UUID NOT NULL,
  target_size NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  connector TEXT NOT NULL,
  client_order_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  timeout_ms INTEGER NOT NULL,
  retry_policy JSONB NOT NULL,
  unwind_strategy TEXT NOT NULL,
  fallback_providers JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX idx_combo_ex_steps_plan ON combo_execution_steps(plan_id);
