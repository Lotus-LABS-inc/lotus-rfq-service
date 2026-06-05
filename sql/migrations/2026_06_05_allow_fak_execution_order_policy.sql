DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'execution_orders_v1_order_policy_check'
  ) THEN
    ALTER TABLE execution_orders_v1
      DROP CONSTRAINT execution_orders_v1_order_policy_check;
  END IF;

  ALTER TABLE execution_orders_v1
    ADD CONSTRAINT execution_orders_v1_order_policy_check
    CHECK (order_policy IN ('FOK', 'FAK'));
END $$;
