ALTER TABLE execution_fee_ledger
    ADD COLUMN IF NOT EXISTS capture_mode TEXT NULL,
    ADD COLUMN IF NOT EXISTS revenue_source TEXT NULL,
    ADD COLUMN IF NOT EXISTS actual_builder_fee_collected NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS shadow_improvement_fee NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS uncollected_improvement_opportunity NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_execution_fee_ledger_revenue_source
    ON execution_fee_ledger(revenue_source, fee_policy_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_fee_ledger_capture_mode
    ON execution_fee_ledger(capture_mode, status, created_at DESC);
