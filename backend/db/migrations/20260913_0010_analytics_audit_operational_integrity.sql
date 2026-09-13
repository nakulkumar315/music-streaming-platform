-- Phase 08: trusted playback analytics, audit immutability and multi-replica job claims.
-- Additive and safe for already-migrated Phase 07 databases.

ALTER TABLE playback_sessions
  ADD COLUMN IF NOT EXISTS analytics_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_accepted_position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trusted_listened_seconds BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_sequence BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS play_counted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'playback_sessions_last_accepted_position_nonnegative'
  ) THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT playback_sessions_last_accepted_position_nonnegative
      CHECK (last_accepted_position >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'playback_sessions_trusted_listened_seconds_nonnegative'
  ) THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT playback_sessions_trusted_listened_seconds_nonnegative
      CHECK (trusted_listened_seconds >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'playback_sessions_last_heartbeat_sequence_nonnegative'
  ) THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT playback_sessions_last_heartbeat_sequence_nonnegative
      CHECK (last_heartbeat_sequence >= 0);
  END IF;
END $$;

ALTER TABLE content_plays
  ADD COLUMN IF NOT EXISTS playback_session_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_content_plays_playback_session'
  ) THEN
    ALTER TABLE content_plays
      ADD CONSTRAINT fk_content_plays_playback_session
      FOREIGN KEY (playback_session_id)
      REFERENCES playback_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_plays_playback_session_unique
  ON content_plays(playback_session_id)
  WHERE playback_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(30) NOT NULL,
  event_key VARCHAR(180) NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  playback_session_id INTEGER REFERENCES playback_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_event_type_valid
    CHECK (event_type IN ('PLAY_STARTED', 'PLAY_COMPLETED', 'CONTENT_VIEWED')),
  CONSTRAINT analytics_events_user_event_key_unique UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_content_created
  ON analytics_events(content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON analytics_events(playback_session_id)
  WHERE playback_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operational_job_runs (
  job_name VARCHAR(100) NOT NULL,
  window_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (job_name, window_key),
  CONSTRAINT operational_job_runs_status_valid
    CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_operational_job_runs_started
  ON operational_job_runs(started_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
