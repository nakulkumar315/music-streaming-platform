-- Phase 04: align playback_sessions persistence with secure playback lifecycle.
-- Safe for existing databases: additive columns, backfilled defaults, idempotent index/constraints.

ALTER TABLE playback_sessions
  ADD COLUMN IF NOT EXISTS current_position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'playback_sessions_current_position_nonnegative'
  ) THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT playback_sessions_current_position_nonnegative
      CHECK (current_position >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'playback_sessions_duration_nonnegative'
  ) THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT playback_sessions_duration_nonnegative
      CHECK (duration >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_playback_sessions_active_user
  ON playback_sessions (user_id, heartbeat_at DESC)
  WHERE ended_at IS NULL;
