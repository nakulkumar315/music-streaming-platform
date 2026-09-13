-- Phase 05 — canonical content governance and media technical lifecycle.
-- Greenfield migration: fail on unexpected schema drift rather than preserving
-- legacy publication/status vocabularies.

ALTER TABLE content_items
  ADD COLUMN is_taken_down BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE content_items
  ALTER COLUMN lifecycle_state SET DEFAULT 'DRAFT',
  ALTER COLUMN lifecycle_state SET NOT NULL,
  ALTER COLUMN is_approved SET DEFAULT FALSE,
  ALTER COLUMN is_approved SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'UPLOADING',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN visibility SET DEFAULT 'PROTECTED',
  ALTER COLUMN visibility SET NOT NULL;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_lifecycle_state_valid
    CHECK (lifecycle_state IN ('DRAFT', 'EARLY_ACCESS')),
  ADD CONSTRAINT content_items_technical_status_valid
    CHECK (status IN ('UPLOADING', 'PROCESSING', 'READY', 'FAILED')),
  ADD CONSTRAINT content_items_approval_state_valid
    CHECK (is_approved = FALSE OR lifecycle_state = 'EARLY_ACCESS'),
  ADD CONSTRAINT content_items_visibility_valid
    CHECK (visibility IN ('PUBLIC', 'PROTECTED', 'PRIVATE_INTERNAL'));

CREATE INDEX idx_content_items_moderation_queue
  ON content_items (lifecycle_state, is_taken_down, status, created_at DESC);

CREATE INDEX idx_content_items_playback_governance
  ON content_items (is_taken_down, lifecycle_state, is_approved, status);
