DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_candidates_provider_type_check'
      AND conrelid = 'route_candidates'::regclass
  ) THEN
    ALTER TABLE route_candidates
      DROP CONSTRAINT route_candidates_provider_type_check;
  END IF;
END $$;

ALTER TABLE route_candidates
  ADD CONSTRAINT route_candidates_provider_type_check
  CHECK (provider_type IN ('LP', 'VENUE', 'INTERNAL_CROSS'));
