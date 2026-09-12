-- Phase 03 production hardening
-- One-time convergence migration from the historical runtime-DDL model to
-- explicit versioned schema management.
--
-- IMPORTANT:
--   * Application startup MUST NOT execute this file automatically.
--   * Run it explicitly through `npm run db:migrate` before deploying the app.
--   * Future schema changes must be added as new immutable migration files.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Core users / artist profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'FAN',
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deletion_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  artist_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified BOOLEAN NOT NULL DEFAULT false,
  trust_score INT NOT NULL DEFAULT 100,
  strike_count INT NOT NULL DEFAULT 0,
  name VARCHAR(255),
  profile_image_url TEXT,
  artist_bio TEXT,
  portfolio_links TEXT[] NOT NULL DEFAULT '{}',
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_features JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS yearly_subscription_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_remarks TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_appeal_message TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INT NOT NULL DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strike_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'FAN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_links TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_artist_status ON users(artist_status);
CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON users(is_deleted);

-- ---------------------------------------------------------------------------
-- Content / moderation / delivery metadata
-- Safe greenfield defaults are intentionally DRAFT + unapproved.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_items (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  artist_id INT NOT NULL,
  thumbnail_url TEXT,
  media_url TEXT,
  audio_url TEXT,
  video_url TEXT,
  genre VARCHAR(80),
  lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  is_approved BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT,
  report_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  subscription_required BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20);
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS thumbnail_storage_key TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS visibility VARCHAR(30) DEFAULT 'PROTECTED';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PENDING_REVIEW';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS original_file_name VARCHAR(255);
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS video_storage_key TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS file_key TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS provider_asset_id TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS audio_provider_asset_id TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS video_provider_asset_id TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS thumbnail_provider_asset_id TEXT;
ALTER TABLE content_items ALTER COLUMN lifecycle_state SET DEFAULT 'DRAFT';
ALTER TABLE content_items ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE content_items ALTER COLUMN report_count SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_content_items_storage_provider ON content_items(storage_provider);
CREATE INDEX IF NOT EXISTS idx_content_items_audio_provider_asset_id ON content_items(audio_provider_asset_id);
CREATE INDEX IF NOT EXISTS idx_content_items_video_provider_asset_id ON content_items(video_provider_asset_id);
CREATE INDEX IF NOT EXISTS idx_content_items_thumbnail_provider_asset_id ON content_items(thumbnail_provider_asset_id);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reason VARCHAR(80),
  content_id INT,
  user_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_content_user ON reports(content_id, user_id);

CREATE TABLE IF NOT EXISTS content_plays (
  id SERIAL PRIMARY KEY,
  content_id INT NOT NULL,
  user_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_plays_content_id ON content_plays(content_id);
CREATE INDEX IF NOT EXISTS idx_content_plays_created_at ON content_plays(created_at);

CREATE TABLE IF NOT EXISTS content_reactions (
  id SERIAL PRIMARY KEY,
  content_id INT NOT NULL,
  user_id INT NOT NULL,
  reaction VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reactions_unique ON content_reactions(content_id, user_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_content_id ON content_reactions(content_id);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  device_name VARCHAR(255),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_device ON user_sessions(user_id, device_id);

-- ---------------------------------------------------------------------------
-- Canonical Phase-1 artist subscription / payment schema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  artist_id INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'ARTIST',
  status VARCHAR(20) NOT NULL DEFAULT 'INACTIVE',
  plan_type VARCHAR(50) DEFAULT 'MONTHLY',
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_billing_date TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS artist_id INT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'ARTIST';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'INACTIVE';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) DEFAULT 'MONTHLY';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE subscriptions ALTER COLUMN auto_renew SET DEFAULT false;

-- Phase-1 purchase service relies on ON CONFLICT(user_id, artist_id).
-- If historical duplicate rows exist, this migration intentionally fails so the
-- data can be reviewed instead of silently deleting or choosing a winner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_artist ON subscriptions(user_id, artist_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_expiry ON subscriptions(status, next_billing_date);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  artist_id INT,
  amount BIGINT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  razorpay_order_id VARCHAR(255),
  razorpay_payment_id VARCHAR(255),
  artist_name VARCHAR(255),
  billing_cycle VARCHAR(50),
  payment_confirmed_at TIMESTAMPTZ,
  failure_reason TEXT,
  refund_amount BIGINT NOT NULL DEFAULT 0,
  refund_status VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS artist_id INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount BIGINT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'PENDING';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS artist_name VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(50);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_razorpay_order ON transactions(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_razorpay_payment ON transactions(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_analytics ON transactions(status, artist_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  user_id INT NOT NULL,
  subscription_id INT NOT NULL,
  amount BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL,
  razorpay_payment_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS subscription_id INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_payment ON payments(razorpay_payment_id);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  subscription_id INT,
  event_type VARCHAR(80) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_audit_subscription ON subscription_audit_logs(subscription_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Analytics / audit / discovery support still used by active modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artist_stats (
  artist_id INT PRIMARY KEY,
  total_plays INT NOT NULL DEFAULT 0,
  total_subscribers INT NOT NULL DEFAULT 0,
  total_earnings NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upsell_metrics (
  user_id INT PRIMARY KEY,
  interaction_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_listening_stats (
  user_id INT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  total_seconds BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_user_listening_stats_lookup ON user_listening_stats(user_id, year, month);

-- Legacy platform config is retained only because existing admin/read paths still
-- reference it. New payment code must not use it as Phase-1 purchase authority.
CREATE TABLE IF NOT EXISTS platform_subscription_configs (
  id SERIAL PRIMARY KEY,
  price NUMERIC NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  duration VARCHAR(20) NOT NULL DEFAULT 'monthly',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  discount_price NUMERIC,
  discount_months INT DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  yearly_price NUMERIC
);
ALTER TABLE platform_subscription_configs ADD COLUMN IF NOT EXISTS discount_price NUMERIC;
ALTER TABLE platform_subscription_configs ADD COLUMN IF NOT EXISTS discount_months INT DEFAULT 1;
ALTER TABLE platform_subscription_configs ADD COLUMN IF NOT EXISTS yearly_price NUMERIC;

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255),
  actor_id INTEGER,
  actor_role VARCHAR(20),
  status VARCHAR(20) NOT NULL,
  correlation_id UUID,
  ip_address VARCHAR(45),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);

CREATE TABLE IF NOT EXISTS featured_artists (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  name VARCHAR(255),
  avatar TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_featured_artists_artist ON featured_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_featured_artists_active ON featured_artists(is_active);
