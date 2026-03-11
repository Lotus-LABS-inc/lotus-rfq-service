CREATE TABLE clearing_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compatibility_bucket TEXT NOT NULL,
  state TEXT NOT NULL,
  participant_count INT NOT NULL CHECK (participant_count > 0 AND participant_count <= 4),
  unique_leg_count INT NOT NULL CHECK (unique_leg_count > 0 AND unique_leg_count <= 6),
  compression_score NUMERIC NOT NULL CHECK (compression_score >= 0),
  participant_set_hash TEXT NOT NULL,
  match_signature_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clearing_rounds_participant_signature UNIQUE (participant_set_hash, match_signature_hash)
);

CREATE INDEX idx_clearing_rounds_bucket_created_at ON clearing_rounds(compatibility_bucket, created_at);
CREATE INDEX idx_clearing_rounds_state_created_at ON clearing_rounds(state, created_at);
CREATE INDEX idx_clearing_rounds_participant_hash ON clearing_rounds(participant_set_hash);

CREATE TABLE clearing_round_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearing_round_id UUID NOT NULL REFERENCES clearing_rounds(id) ON DELETE CASCADE,
  combo_or_order_id UUID NOT NULL,
  participant_user_id UUID NOT NULL,
  role TEXT NOT NULL,
  original_remaining JSONB NOT NULL,
  matched_remaining JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clearing_round_participants_entry UNIQUE (clearing_round_id, combo_or_order_id, role)
);

CREATE INDEX idx_clearing_round_participants_round_id ON clearing_round_participants(clearing_round_id);
CREATE INDEX idx_clearing_round_participants_combo_or_order_id ON clearing_round_participants(combo_or_order_id);
CREATE INDEX idx_clearing_round_participants_user_id ON clearing_round_participants(participant_user_id);

CREATE TABLE clearing_round_leg_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearing_round_id UUID NOT NULL REFERENCES clearing_rounds(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  participant_id UUID NOT NULL REFERENCES clearing_round_participants(id) ON DELETE CASCADE,
  signed_matched_size NUMERIC NOT NULL CHECK (signed_matched_size <> 0),
  price NUMERIC NULL CHECK (price IS NULL OR price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clearing_round_leg_match UNIQUE (clearing_round_id, market_id, outcome_id, participant_id)
);

CREATE INDEX idx_clearing_round_leg_matches_round_id ON clearing_round_leg_matches(clearing_round_id);
CREATE INDEX idx_clearing_round_leg_matches_market_outcome ON clearing_round_leg_matches(market_id, outcome_id);
CREATE INDEX idx_clearing_round_leg_matches_participant_id ON clearing_round_leg_matches(participant_id);

CREATE TABLE clearing_round_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearing_round_id UUID NOT NULL REFERENCES clearing_rounds(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clearing_round_events_round_id ON clearing_round_events(clearing_round_id);
CREATE INDEX idx_clearing_round_events_type_created_at ON clearing_round_events(event_type, created_at);
