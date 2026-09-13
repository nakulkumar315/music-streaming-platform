-- Phase 05 — provider-neutral public artist profile/banner assets.
-- Public URLs remain stable backend routes while provider identity stays internal.

CREATE TABLE user_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  kind VARCHAR(20) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL,
  storage_key TEXT NOT NULL,
  provider_asset_id TEXT,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_media_assets_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_media_assets_user_kind_unique
    UNIQUE (user_id, kind),
  CONSTRAINT user_media_assets_kind_valid
    CHECK (kind IN ('PROFILE', 'BANNER')),
  CONSTRAINT user_media_assets_provider_valid
    CHECK (storage_provider IN ('local', 'firebase', 's3', 'cloudinary')),
  CONSTRAINT user_media_assets_size_positive
    CHECK (size_bytes > 0)
);

CREATE INDEX idx_user_media_assets_provider
  ON user_media_assets (storage_provider, storage_key);
