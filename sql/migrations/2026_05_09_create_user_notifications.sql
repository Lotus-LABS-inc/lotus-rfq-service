CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  target_kind TEXT,
  target_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
  ON user_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
