DO $$
BEGIN
  IF to_regclass('public.historical_simulation_runs') IS NOT NULL THEN
    ALTER TABLE historical_simulation_runs
    ADD COLUMN IF NOT EXISTS qualification_run_id UUID NULL REFERENCES strategy_qualification_runs(id) ON DELETE SET NULL;

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_historical_simulation_runs_qualification_run_id
      ON historical_simulation_runs(qualification_run_id)
    ';
  END IF;
END $$;
