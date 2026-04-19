-- Migration: Add canonical_market_id to historical_market_states
-- Description: Support granular market identity in historical data for more precise simulations.

DO $$
BEGIN
  IF to_regclass('public.historical_market_states') IS NOT NULL THEN
    ALTER TABLE historical_market_states
    ADD COLUMN IF NOT EXISTS canonical_market_id TEXT;

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_historical_market_states_canonical_market_id
      ON historical_market_states(canonical_market_id)
    ';
  END IF;
END $$;

-- Optional: Update existing records if we can infer them (though usually historical data is unmapped initially)
-- UPDATE historical_market_states SET canonical_market_id = ...
