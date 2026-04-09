ALTER TABLE execution_control_decisions
    DROP CONSTRAINT IF EXISTS execution_control_decisions_canonical_event_id_fkey;

ALTER TABLE execution_control_decisions
    ALTER COLUMN canonical_event_id DROP NOT NULL;
