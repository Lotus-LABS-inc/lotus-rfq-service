CREATE TABLE IF NOT EXISTS execution_orders_v1 (
  order_id text NOT NULL,
  user_id text NOT NULL,
  quote_id text,
  execution_id text,
  state text NOT NULL CHECK (state IN (
    'READY_TO_PLACE',
    'NEEDS_SIGNATURE',
    'NEEDS_VENUE_SETUP',
    'WAITING_FOR_VENUE_READY',
    'BLOCKED_ACTION_REQUIRED',
    'SUBMITTING',
    'SUBMITTED',
    'FILLED',
    'FAILED',
    'EXPIRED'
  )),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  market_id text NOT NULL,
  outcome_id text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  venue_preference text NOT NULL CHECK (venue_preference IN (
    'BEST_ROUTE',
    'POLYMARKET',
    'LIMITLESS',
    'PREDICT_FUN',
    'OPINION'
  )),
  signing_mode text NOT NULL CHECK (signing_mode IN (
    'NONE',
    'USER_SIGNATURE_REQUIRED',
    'BACKEND_SIGNABLE',
    'MIXED',
    'UNSUPPORTED'
  )),
  primary_action text NOT NULL CHECK (primary_action IN ('PLACE_ORDER', 'SIGN', 'ENABLE_VENUE', 'NONE')),
  readiness_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  venue_capability_summary jsonb NOT NULL DEFAULT '{"venues":[]}'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature_request_hash text,
  last_error text,
  expires_at timestamptz,
  next_poll_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, user_id)
);

CREATE INDEX IF NOT EXISTS execution_orders_v1_user_updated_idx
  ON execution_orders_v1 (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS execution_orders_v1_refreshable_idx
  ON execution_orders_v1 (state, next_poll_at, updated_at)
  WHERE state IN ('SUBMITTING', 'SUBMITTED');
