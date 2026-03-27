ALTER TABLE resolution_risk_assessments
    ADD COLUMN IF NOT EXISTS liquidity_cost NUMERIC NULL;

ALTER TABLE resolution_risk_assessments
    ADD COLUMN IF NOT EXISTS max_settlement_delay_hours NUMERIC NULL;
