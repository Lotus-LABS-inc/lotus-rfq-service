-- Authoritative exposure per (user, market, side)
CREATE TABLE exposure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  canonical_market_id UUID NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  gross_notional NUMERIC NOT NULL DEFAULT 0,  -- absolute exposure
  net_notional NUMERIC NOT NULL DEFAULT 0,    -- signed
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 1,
  metadata JSONB,
  UNIQUE(user_id, canonical_market_id, side)
);

CREATE INDEX idx_exposure_user ON exposure(user_id);
CREATE INDEX idx_exposure_market ON exposure(canonical_market_id);

-- Exposure ledger (append-only) for audit & reconciliation
CREATE TABLE exposure_journal (
  id BIGSERIAL PRIMARY KEY,
  exposure_id UUID,
  change NUMERIC NOT NULL,
  prev_gross NUMERIC,
  prev_net NUMERIC,
  new_gross NUMERIC,
  new_net NUMERIC,
  source TEXT NOT NULL,    -- e.g., 'rfq-execution', 'reconcile', 'admin-adjust'
  reference_id UUID,       -- rfq_id or execution_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB
);

CREATE INDEX idx_journal_exposure_id ON exposure_journal(exposure_id);
CREATE INDEX idx_journal_reference_id ON exposure_journal(reference_id);

-- Idempotency table for execution updates
CREATE TABLE exposure_idempotency (
  id UUID PRIMARY KEY, -- execution_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
