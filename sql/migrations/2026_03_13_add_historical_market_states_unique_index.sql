DO $$
BEGIN
  IF to_regclass('public.historical_market_states') IS NOT NULL THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_historical_market_states_identity_unique
          ON historical_market_states (
              canonical_event_id,
              venue,
              venue_market_id,
              "timestamp",
              metadata_version
          )
    ';
  END IF;
END $$;
