DO $$
BEGIN
  IF to_regclass('public.predict_fallback_historical_snapshots') IS NOT NULL THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS uq_predict_fallback_historical_snapshots_identity
          ON predict_fallback_historical_snapshots(environment, market_id, provenance, source_timestamp)
    ';
  END IF;
END $$;
