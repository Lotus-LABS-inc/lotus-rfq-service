CREATE INDEX IF NOT EXISTS idx_user_venue_account_audit_events_coalesce
    ON user_venue_account_audit_events (
        user_id,
        venue_account_id,
        event_type,
        (md5(payload::text)),
        created_at DESC
    );
