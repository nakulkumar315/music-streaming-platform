-- Phase 09B: privacy lifecycle, retention tooling and provider deletion reconciliation.
-- Retention durations are intentionally NOT encoded here; they must come from an
-- approved business/legal/operational policy and are supplied to cleanup tooling.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymization_reason TEXT;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS physical_deletion_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS physical_deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS physical_deleted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_items_physical_deletion_status_valid'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_physical_deletion_status_valid
      CHECK (physical_deletion_status IN ('NOT_REQUESTED', 'PENDING', 'FAILED', 'COMPLETED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS media_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(30) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  asset_kind VARCHAR(30) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL,
  storage_key TEXT NOT NULL,
  provider_asset_id TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_deletion_requests_entity_type_valid
    CHECK (entity_type IN ('USER_ASSET', 'CONTENT_ASSET')),
  CONSTRAINT media_deletion_requests_status_valid
    CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED')),
  CONSTRAINT media_deletion_requests_provider_valid
    CHECK (storage_provider IN ('local', 'firebase', 's3', 'cloudinary')),
  CONSTRAINT media_deletion_requests_attempt_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_deletion_requests_asset_unique
  ON media_deletion_requests(entity_type, entity_id, asset_kind, storage_provider, storage_key);

CREATE INDEX IF NOT EXISTS idx_media_deletion_requests_pending
  ON media_deletion_requests(status, next_attempt_at, requested_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_content_items_physical_deletion
  ON content_items(physical_deletion_status, physical_deletion_requested_at)
  WHERE physical_deletion_status <> 'NOT_REQUESTED';

CREATE INDEX IF NOT EXISTS idx_users_anonymized_at
  ON users(anonymized_at)
  WHERE anonymized_at IS NOT NULL;

-- Cleanup scans need deterministic indexes, but the age cutoff remains an
-- explicit policy input rather than an invented legal duration.
CREATE INDEX IF NOT EXISTS idx_user_sessions_retention_cleanup
  ON user_sessions(last_active_at, id);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_retention_cleanup
  ON playback_sessions(ended_at, id)
  WHERE ended_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_retention_cleanup
  ON analytics_events(created_at, id);
