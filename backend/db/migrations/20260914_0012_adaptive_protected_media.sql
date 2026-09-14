-- Phase 09A: adaptive streaming readiness and protected-delivery metadata.
-- Additive only. Existing playback/content identities are preserved.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS adaptive_status VARCHAR(20) NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS adaptive_qualities TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_width INTEGER,
  ADD COLUMN IF NOT EXISTS source_height INTEGER;

-- Cloudinary video rows require an HLS readiness check/backfill before they may
-- advertise adaptive playback. Other providers remain progressive unless a
-- secure adaptive strategy is implemented for them later.
UPDATE content_items
   SET adaptive_status = 'PENDING'
 WHERE UPPER(type) = 'VIDEO'
   AND LOWER(storage_provider) = 'cloudinary'
   AND adaptive_status = 'NOT_APPLICABLE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_items_adaptive_status_valid'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_adaptive_status_valid
      CHECK (adaptive_status IN ('NOT_APPLICABLE', 'PENDING', 'READY', 'FAILED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_items_adaptive_qualities_valid'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_adaptive_qualities_valid
      CHECK (
        adaptive_qualities <@ ARRAY['144p','240p','360p','480p','720p','1080p']::text[]
        AND cardinality(adaptive_qualities) <= 6
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_items_source_width_positive'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_source_width_positive
      CHECK (source_width IS NULL OR source_width > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_items_source_height_positive'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_source_height_positive
      CHECK (source_height IS NULL OR source_height > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_items_adaptive_readiness
  ON content_items(adaptive_status, storage_provider, type)
  WHERE UPPER(type) = 'VIDEO';
