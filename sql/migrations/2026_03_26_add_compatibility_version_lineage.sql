ALTER TABLE route_selection_traces
    ADD COLUMN IF NOT EXISTS compatibility_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE execution_intents
    ADD COLUMN IF NOT EXISTS compatibility_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_route_selection_traces_compatibility_version_ids
    ON route_selection_traces
    USING GIN (compatibility_version_ids);

CREATE INDEX IF NOT EXISTS idx_execution_intents_compatibility_version_ids
    ON execution_intents
    USING GIN (compatibility_version_ids);
