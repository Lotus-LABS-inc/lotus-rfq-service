CREATE TABLE combo_netting_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_combo_id UUID NOT NULL REFERENCES combo_rfqs(id) ON DELETE CASCADE,
  matched_combo_id UUID NOT NULL REFERENCES combo_rfqs(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  matched_size NUMERIC NOT NULL CHECK (matched_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_combo_netting_group_pair UNIQUE (incoming_combo_id, matched_combo_id),
  CONSTRAINT chk_combo_netting_groups_distinct_pair CHECK (incoming_combo_id <> matched_combo_id)
);

CREATE INDEX idx_combo_netting_groups_incoming_combo_id ON combo_netting_groups(incoming_combo_id);
CREATE INDEX idx_combo_netting_groups_matched_combo_id ON combo_netting_groups(matched_combo_id);
CREATE INDEX idx_combo_netting_groups_created_at ON combo_netting_groups(created_at);

CREATE TABLE combo_netting_match_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_group_id UUID NOT NULL REFERENCES combo_netting_groups(id) ON DELETE CASCADE,
  incoming_leg_id UUID NOT NULL REFERENCES combo_legs(id) ON DELETE CASCADE,
  matched_leg_id UUID NOT NULL REFERENCES combo_legs(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  matched_size NUMERIC NOT NULL CHECK (matched_size > 0),
  price NUMERIC NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_combo_netting_match_leg_pair UNIQUE (netting_group_id, incoming_leg_id, matched_leg_id),
  CONSTRAINT chk_combo_netting_match_legs_distinct_pair CHECK (incoming_leg_id <> matched_leg_id)
);

CREATE INDEX idx_combo_netting_match_legs_group_id ON combo_netting_match_legs(netting_group_id);
CREATE INDEX idx_combo_netting_match_legs_incoming_leg_id ON combo_netting_match_legs(incoming_leg_id);
CREATE INDEX idx_combo_netting_match_legs_matched_leg_id ON combo_netting_match_legs(matched_leg_id);
CREATE INDEX idx_combo_netting_match_legs_market_outcome ON combo_netting_match_legs(market_id, outcome_id);

CREATE TABLE combo_netting_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  netting_group_id UUID NOT NULL REFERENCES combo_netting_groups(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_combo_netting_events_group_id ON combo_netting_events(netting_group_id);
CREATE INDEX idx_combo_netting_events_event_type_created_at ON combo_netting_events(event_type, created_at);
