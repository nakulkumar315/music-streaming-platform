-- Phase 06A: account-level resume playback state.
-- Deliberately separate from playback_history/content_plays and playback_sessions
-- so UX resume writes cannot inflate trusted analytics or alter session leases.

CREATE TABLE IF NOT EXISTS playback_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_playback_progress_user_updated
  ON playback_progress(user_id, updated_at DESC);
