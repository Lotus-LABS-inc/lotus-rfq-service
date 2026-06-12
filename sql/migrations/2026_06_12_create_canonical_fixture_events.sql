CREATE TABLE IF NOT EXISTS canonical_fixture_events (
    id UUID PRIMARY KEY,
    fixture_key TEXT NOT NULL UNIQUE,
    display_title TEXT NOT NULL,
    category TEXT NOT NULL,
    scheduled_at DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_fixture_events_category_scheduled
    ON canonical_fixture_events(category, scheduled_at);

ALTER TABLE canonical_events
    ADD COLUMN IF NOT EXISTS canonical_fixture_event_id UUID REFERENCES canonical_fixture_events(id);

CREATE INDEX IF NOT EXISTS idx_canonical_events_fixture_event_id
    ON canonical_events(canonical_fixture_event_id);
