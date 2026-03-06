-- routing_plans
CREATE TABLE routing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL,
  acceptance_policy TEXT NOT NULL,
  reservation_token TEXT,
  created_by UUID,
  state TEXT NOT NULL,
  cost_estimate NUMERIC,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_routing_plans_rfq ON routing_plans(rfq_id);

-- route_candidates
CREATE TABLE route_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_plan_id UUID REFERENCES routing_plans(id) ON DELETE CASCADE,
  leg_id UUID NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('LP','VENUE','INTERNAL')),
  provider_id TEXT,
  available_size NUMERIC,
  quoted_price NUMERIC,
  fees JSONB,
  latency_ms INT,
  fill_prob NUMERIC,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_route_candidates_plan ON route_candidates(routing_plan_id);

-- route_steps
CREATE TABLE route_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_plan_id UUID REFERENCES routing_plans(id),
  leg_id UUID,
  step_index INT,
  provider_type TEXT,
  provider_id TEXT,
  target_size NUMERIC,
  rounded_size NUMERIC,
  target_price NUMERIC,
  client_order_id TEXT,
  idempotency_key TEXT,
  state TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  metadata JSONB
);
CREATE INDEX idx_route_steps_plan ON route_steps(routing_plan_id);

-- route_history
CREATE TABLE route_history (
  id BIGSERIAL PRIMARY KEY,
  routing_plan_id UUID,
  event_type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
