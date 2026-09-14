-- Phase 09: future distribution-ready release domain.
-- Additive only: current content_items IDs remain the Phase-1 browse/playback identity.
-- No external distributor integration or network workflow is introduced here.

CREATE TABLE IF NOT EXISTS releases (
  id BIGSERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  version_subtitle VARCHAR(255),
  release_type VARCHAR(20) NOT NULL DEFAULT 'SINGLE',
  primary_genre VARCHAR(80),
  secondary_genre VARCHAR(80),
  language VARCHAR(50),
  explicit BOOLEAN NOT NULL DEFAULT FALSE,
  label_name VARCHAR(255),
  copyright_text VARCHAR(500),
  phonographic_copyright_text VARCHAR(500),
  early_access_start_at TIMESTAMPTZ,
  public_release_at TIMESTAMPTZ,
  exclusivity_end_at TIMESTAMPTZ,
  release_phase VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  distribution_status VARCHAR(40) NOT NULL DEFAULT 'NOT_SUBMITTED',
  upc_ean VARCHAR(14),
  artwork_storage_key TEXT,
  artwork_provider_asset_id TEXT,
  source_content_id INTEGER,
  version_no INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_releases_artist FOREIGN KEY (artist_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_releases_source_content FOREIGN KEY (source_content_id) REFERENCES content_items(id) ON DELETE RESTRICT,
  CONSTRAINT releases_source_content_unique UNIQUE (source_content_id),
  CONSTRAINT releases_id_artist_unique UNIQUE (id, artist_id),
  CONSTRAINT releases_release_type_valid CHECK (release_type IN ('SINGLE', 'EP', 'ALBUM')),
  CONSTRAINT releases_release_phase_valid CHECK (release_phase IN ('DRAFT', 'PENDING_REVIEW', 'EARLY_ACCESS', 'PUBLIC', 'EXCLUSIVITY_ENDED', 'TAKEDOWN')),
  CONSTRAINT releases_distribution_status_valid CHECK (distribution_status IN ('NOT_READY', 'READY_FOR_DISTRIBUTION', 'NOT_SUBMITTED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PARTIALLY_DISTRIBUTED', 'DISTRIBUTED', 'REJECTED', 'TAKEDOWN_REQUESTED', 'TAKEN_DOWN')),
  CONSTRAINT releases_upc_ean_shape_valid CHECK (upc_ean IS NULL OR upc_ean ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$'),
  CONSTRAINT releases_version_positive CHECK (version_no > 0),
  CONSTRAINT releases_public_after_early_access CHECK (public_release_at IS NULL OR early_access_start_at IS NULL OR public_release_at >= early_access_start_at),
  CONSTRAINT releases_exclusivity_after_release_dates CHECK (
    exclusivity_end_at IS NULL
    OR ((early_access_start_at IS NULL OR exclusivity_end_at >= early_access_start_at)
        AND (public_release_at IS NULL OR exclusivity_end_at >= public_release_at))
  )
);

CREATE INDEX IF NOT EXISTS idx_releases_artist_created ON releases(artist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_phase ON releases(release_phase, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_distribution_status ON releases(distribution_status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_upc_ean_unique ON releases(upc_ean) WHERE upc_ean IS NOT NULL;

CREATE TABLE IF NOT EXISTS release_tracks (
  id BIGSERIAL PRIMARY KEY,
  release_id BIGINT NOT NULL,
  content_item_id INTEGER,
  artist_id INTEGER NOT NULL,
  disc_number INTEGER NOT NULL DEFAULT 1,
  track_number INTEGER NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  version_mix VARCHAR(255),
  duration_ms BIGINT,
  explicit BOOLEAN,
  isrc VARCHAR(12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_release_tracks_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  CONSTRAINT fk_release_tracks_content FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_release_tracks_artist FOREIGN KEY (artist_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_release_tracks_release_artist FOREIGN KEY (release_id, artist_id) REFERENCES releases(id, artist_id) ON DELETE CASCADE,
  CONSTRAINT release_tracks_content_unique UNIQUE (content_item_id),
  CONSTRAINT release_tracks_order_unique UNIQUE (release_id, disc_number, track_number),
  CONSTRAINT release_tracks_release_id_id_unique UNIQUE (release_id, id),
  CONSTRAINT release_tracks_disc_positive CHECK (disc_number > 0),
  CONSTRAINT release_tracks_track_positive CHECK (track_number > 0),
  CONSTRAINT release_tracks_duration_positive CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT release_tracks_isrc_shape_valid CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$')
);

CREATE INDEX IF NOT EXISTS idx_release_tracks_release ON release_tracks(release_id, disc_number, track_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_release_tracks_isrc_unique ON release_tracks(isrc) WHERE isrc IS NOT NULL;

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS release_track_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_items_release_track') THEN
    ALTER TABLE content_items
      ADD CONSTRAINT fk_content_items_release_track
      FOREIGN KEY (release_track_id) REFERENCES release_tracks(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_release_track_unique
  ON content_items(release_track_id) WHERE release_track_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS release_contributors (
  id BIGSERIAL PRIMARY KEY,
  release_id BIGINT NOT NULL,
  release_track_id BIGINT,
  contributor_user_id INTEGER,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_release_contributors_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  CONSTRAINT fk_release_contributors_track FOREIGN KEY (release_track_id) REFERENCES release_tracks(id) ON DELETE CASCADE,
  CONSTRAINT fk_release_contributors_release_track FOREIGN KEY (release_id, release_track_id) REFERENCES release_tracks(release_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_release_contributors_user FOREIGN KEY (contributor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT release_contributors_role_valid CHECK (role IN ('PRIMARY_ARTIST', 'FEATURED_ARTIST', 'COMPOSER', 'LYRICIST', 'PRODUCER', 'REMIXER')),
  CONSTRAINT release_contributors_display_order_nonnegative CHECK (display_order >= 0)
);

CREATE INDEX IF NOT EXISTS idx_release_contributors_release ON release_contributors(release_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_release_contributors_track ON release_contributors(release_track_id, display_order, id) WHERE release_track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_release_contributors_known_user_role_unique
  ON release_contributors(release_id, COALESCE(release_track_id, 0), contributor_user_id, role)
  WHERE contributor_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_platform_links (
  id BIGSERIAL PRIMARY KEY,
  release_id BIGINT NOT NULL,
  release_track_id BIGINT,
  platform_code VARCHAR(50) NOT NULL,
  external_url TEXT NOT NULL,
  external_platform_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_external_platform_links_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_platform_links_track FOREIGN KEY (release_track_id) REFERENCES release_tracks(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_platform_links_release_track FOREIGN KEY (release_id, release_track_id) REFERENCES release_tracks(release_id, id) ON DELETE CASCADE,
  CONSTRAINT external_platform_links_status_valid CHECK (status IN ('ACTIVE', 'REMOVED')),
  CONSTRAINT external_platform_links_url_http CHECK (external_url ~ '^https://')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_platform_links_scope_unique
  ON external_platform_links(release_id, COALESCE(release_track_id, 0), platform_code);

CREATE TABLE IF NOT EXISTS distribution_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id BIGINT NOT NULL,
  provider_code VARCHAR(50) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  provider_reference VARCHAR(255),
  status VARCHAR(40) NOT NULL DEFAULT 'NOT_SUBMITTED',
  metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  last_error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_distribution_submissions_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  CONSTRAINT distribution_submissions_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT distribution_submissions_release_id_id_unique UNIQUE (release_id, id),
  CONSTRAINT distribution_submissions_status_valid CHECK (status IN ('NOT_SUBMITTED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PARTIALLY_DISTRIBUTED', 'DISTRIBUTED', 'REJECTED', 'TAKEDOWN_REQUESTED', 'TAKEN_DOWN', 'FAILED')),
  CONSTRAINT distribution_submissions_attempt_nonnegative CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_distribution_submissions_release ON distribution_submissions(release_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_distribution_submissions_status ON distribution_submissions(status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_distribution_submissions_provider_reference_unique
  ON distribution_submissions(provider_code, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS distribution_platform_statuses (
  id BIGSERIAL PRIMARY KEY,
  submission_id UUID NOT NULL,
  platform_code VARCHAR(50) NOT NULL,
  status VARCHAR(40) NOT NULL,
  external_platform_id VARCHAR(255),
  external_url TEXT,
  status_reason VARCHAR(500),
  status_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_distribution_platform_status_submission FOREIGN KEY (submission_id) REFERENCES distribution_submissions(id) ON DELETE CASCADE,
  CONSTRAINT distribution_platform_status_unique UNIQUE (submission_id, platform_code),
  CONSTRAINT distribution_platform_status_valid CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'DISTRIBUTED', 'TAKEDOWN_REQUESTED', 'TAKEN_DOWN', 'FAILED')),
  CONSTRAINT distribution_platform_external_url_http CHECK (external_url IS NULL OR external_url ~ '^https://')
);

CREATE TABLE IF NOT EXISTS distribution_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id BIGINT NOT NULL,
  submission_id UUID,
  event_key VARCHAR(180) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_distribution_outbox_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  CONSTRAINT fk_distribution_outbox_submission FOREIGN KEY (submission_id) REFERENCES distribution_submissions(id) ON DELETE SET NULL,
  CONSTRAINT fk_distribution_outbox_release_submission FOREIGN KEY (release_id, submission_id) REFERENCES distribution_submissions(release_id, id) ON DELETE SET NULL,
  CONSTRAINT distribution_outbox_event_key_unique UNIQUE (event_key),
  CONSTRAINT distribution_outbox_status_valid CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  CONSTRAINT distribution_outbox_attempt_nonnegative CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_distribution_outbox_pending
  ON distribution_outbox(status, available_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');

-- Idempotent backfill: current Phase-1 uploads are one row per audio item. Those
-- rows can therefore be represented safely as SINGLE releases. Video rows remain
-- deliberately unmapped until a separate business rule defines music-video release semantics.
INSERT INTO releases (
  artist_id, title, release_type, primary_genre, explicit,
  release_phase, distribution_status, artwork_storage_key,
  artwork_provider_asset_id, source_content_id, created_at, updated_at
)
SELECT
  c.artist_id,
  c.title,
  'SINGLE',
  c.genre,
  FALSE,
  CASE
    WHEN c.is_taken_down = TRUE THEN 'TAKEDOWN'
    WHEN UPPER(c.lifecycle_state) = 'EARLY_ACCESS' THEN 'EARLY_ACCESS'
    WHEN UPPER(c.lifecycle_state) = 'PENDING_REVIEW' THEN 'PENDING_REVIEW'
    ELSE 'DRAFT'
  END,
  'NOT_SUBMITTED',
  c.thumbnail_storage_key,
  c.thumbnail_provider_asset_id,
  c.id,
  c.created_at,
  now()
FROM content_items c
WHERE UPPER(c.type) = 'AUDIO'
ON CONFLICT (source_content_id) DO NOTHING;

INSERT INTO release_tracks (
  release_id, content_item_id, artist_id, disc_number, track_number,
  title, explicit, created_at, updated_at
)
SELECT
  r.id,
  c.id,
  c.artist_id,
  1,
  1,
  c.title,
  FALSE,
  c.created_at,
  now()
FROM releases r
JOIN content_items c ON c.id = r.source_content_id
WHERE UPPER(c.type) = 'AUDIO'
ON CONFLICT (content_item_id) DO NOTHING;

UPDATE content_items c
SET release_track_id = rt.id
FROM release_tracks rt
WHERE rt.content_item_id = c.id
  AND c.release_track_id IS DISTINCT FROM rt.id;

INSERT INTO release_contributors (
  release_id, release_track_id, contributor_user_id, display_name, role, display_order
)
SELECT
  rt.release_id,
  rt.id,
  u.id,
  COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)),
  'PRIMARY_ARTIST',
  0
FROM release_tracks rt
JOIN users u ON u.id = rt.artist_id
WHERE rt.content_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM release_contributors rc
    WHERE rc.release_id = rt.release_id
      AND rc.release_track_id = rt.id
      AND rc.contributor_user_id = u.id
      AND rc.role = 'PRIMARY_ARTIST'
  );
