BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rfq_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  canonical_market_id TEXT NOT NULL,
  taker_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity NUMERIC(24, 8) NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_id TEXT NOT NULL,
  key_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES rfq_sessions(id) ON DELETE CASCADE,
  lp_key_id UUID NOT NULL REFERENCES lp_keys(id),
  quote_status TEXT NOT NULL,
  price NUMERIC(24, 8) NOT NULL,
  quantity NUMERIC(24, 8) NOT NULL,
  fee_bps INTEGER NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  quote_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES rfq_sessions(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES rfq_quotes(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES rfq_sessions(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES rfq_quotes(id),
  execution_status TEXT NOT NULL,
  executed_price NUMERIC(24, 8) NOT NULL,
  executed_quantity NUMERIC(24, 8) NOT NULL,
  venue_execution_ref TEXT,
  transaction_hash TEXT,
  execution_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
