DO $$
BEGIN
  IF to_regclass('public.combo_rfqs') IS NOT NULL
     AND to_regclass('public.combo_netting_groups') IS NOT NULL THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS combo_netting_attempts (
        attempt_id TEXT PRIMARY KEY,
        incoming_combo_id UUID NOT NULL REFERENCES combo_rfqs(id) ON DELETE CASCADE,
        matched_combo_id UUID NOT NULL REFERENCES combo_rfqs(id) ON DELETE CASCADE,
        netting_group_id UUID REFERENCES combo_netting_groups(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_combo_netting_attempts_incoming_combo_id
      ON combo_netting_attempts(incoming_combo_id)
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_combo_netting_attempts_matched_combo_id
      ON combo_netting_attempts(matched_combo_id)
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_combo_netting_attempts_group_id
      ON combo_netting_attempts(netting_group_id)
    ';
  END IF;
END $$;
