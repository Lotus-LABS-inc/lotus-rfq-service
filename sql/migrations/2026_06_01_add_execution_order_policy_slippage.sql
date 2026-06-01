ALTER TABLE execution_orders_v1
  ADD COLUMN IF NOT EXISTS order_policy text NOT NULL DEFAULT 'FOK',
  ADD COLUMN IF NOT EXISTS slippage_tolerance_bps integer NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_orders_v1_order_policy_check'
  ) THEN
    ALTER TABLE execution_orders_v1
      ADD CONSTRAINT execution_orders_v1_order_policy_check
      CHECK (order_policy IN ('FOK'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_orders_v1_slippage_tolerance_bps_check'
  ) THEN
    ALTER TABLE execution_orders_v1
      ADD CONSTRAINT execution_orders_v1_slippage_tolerance_bps_check
      CHECK (slippage_tolerance_bps >= 0 AND slippage_tolerance_bps <= 500);
  END IF;
END $$;
