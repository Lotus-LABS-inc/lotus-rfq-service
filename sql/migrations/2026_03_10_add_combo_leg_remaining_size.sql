ALTER TABLE combo_legs
  ADD COLUMN IF NOT EXISTS remaining_size NUMERIC;

UPDATE combo_legs
SET remaining_size = size
WHERE remaining_size IS NULL;

ALTER TABLE combo_legs
  ALTER COLUMN remaining_size SET NOT NULL;

ALTER TABLE combo_legs
  ADD CONSTRAINT chk_combo_legs_remaining_size_non_negative CHECK (remaining_size >= 0);

CREATE INDEX IF NOT EXISTS idx_combo_legs_combo_remaining
  ON combo_legs(combo_rfq_id, remaining_size);
