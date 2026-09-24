-- Phase 02 — User profile extended fields (username, location, settings)
-- Ensures fans can update and persist their username, location, and account settings.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_pref BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS audio_quality_pref VARCHAR(20) NOT NULL DEFAULT 'HIGH';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL;
