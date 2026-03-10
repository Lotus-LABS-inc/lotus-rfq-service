DO $$
BEGIN
    ALTER TYPE internal_order_status ADD VALUE IF NOT EXISTS 'PARTIAL';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
