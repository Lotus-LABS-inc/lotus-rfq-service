DO $$
BEGIN
  IF to_regclass('public.route_candidates') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'route_candidates_provider_type_check'
        AND conrelid = 'route_candidates'::regclass
    ) THEN
      ALTER TABLE route_candidates
        DROP CONSTRAINT route_candidates_provider_type_check;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.route_candidates') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'route_candidates_provider_type_check'
        AND conrelid = 'route_candidates'::regclass
    ) THEN
      ALTER TABLE route_candidates
        ADD CONSTRAINT route_candidates_provider_type_check
        CHECK (provider_type IN ('LP', 'VENUE', 'INTERNAL_CROSS'));
    END IF;
  END IF;
END $$;
