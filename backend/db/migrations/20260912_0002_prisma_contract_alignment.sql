-- Align the explicit SQL schema with the complete application/Prisma contract.
-- This migration deliberately fails on incompatible historical financial
-- schemas instead of deleting or guessing financial data.

-- Artist agreement / commercial metadata already represented by Prisma.
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_accepted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_revenue_share INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_revenue_share INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digital_signature TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_signed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_status VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_start_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_pdf_path VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_ip_address VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_user_agent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS genre VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_users_agreement_id ON users(agreement_id);

CREATE TABLE IF NOT EXISTS revenue_share_configs (
  id SERIAL PRIMARY KEY,
  version VARCHAR(20) NOT NULL UNIQUE,
  artist_share INT NOT NULL,
  platform_share INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revenue_share_configs_version ON revenue_share_configs(version);
CREATE INDEX IF NOT EXISTS idx_revenue_share_configs_effective_from ON revenue_share_configs(effective_from);

CREATE TABLE IF NOT EXISTS terms_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(20) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_from TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_terms_versions_version ON terms_versions(version);
CREATE INDEX IF NOT EXISTS idx_terms_versions_effective_from ON terms_versions(effective_from);

CREATE TABLE IF NOT EXISTS playback_history (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  content_id INT NOT NULL,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS playback_history_user_id_content_id_key
  ON playback_history(user_id, content_id);
CREATE INDEX IF NOT EXISTS idx_playback_history_played_at ON playback_history(played_at);
CREATE INDEX IF NOT EXISTS idx_playback_history_user_id ON playback_history(user_id);

CREATE TABLE IF NOT EXISTS playback_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  content_id INT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_user ON playback_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_heartbeat ON playback_sessions(heartbeat_at);

-- Complete columns that older ad-hoc financial bootstrap paths may have omitted.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS artist_id INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS subscription_id INT;

-- Keep SQL types aligned with Prisma and the active payment domain.
ALTER TABLE content_items
  ALTER COLUMN file_size_bytes TYPE INTEGER USING file_size_bytes::INTEGER;
ALTER TABLE transactions ALTER COLUMN id TYPE BIGINT;
ALTER TABLE transactions ALTER COLUMN amount TYPE BIGINT USING amount::BIGINT;
ALTER TABLE transactions ALTER COLUMN refund_amount TYPE BIGINT USING refund_amount::BIGINT;
ALTER TABLE payments ALTER COLUMN amount TYPE BIGINT USING amount::BIGINT;
ALTER TABLE subscription_audit_logs ALTER COLUMN id TYPE BIGINT;
ALTER TABLE processed_webhook_events ALTER COLUMN event_id TYPE VARCHAR(255);
ALTER TABLE subscription_audit_logs ALTER COLUMN event_type TYPE VARCHAR(80);

-- Greenfield-safe defaults: omitted moderation/payment state must never silently
-- publish content or claim recurring billing.
ALTER TABLE content_items ALTER COLUMN lifecycle_state SET DEFAULT 'DRAFT';
ALTER TABLE content_items ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE content_items ALTER COLUMN status SET DEFAULT 'PENDING_REVIEW';
ALTER TABLE subscriptions ALTER COLUMN auto_renew SET DEFAULT false;

-- Financial compatibility/integrity checks. Never guess or rewrite ownership of
-- historical financial rows. Incompatible environments require an explicit,
-- reviewed cleanup/data migration before this release may start.
DO $$
DECLARE
  payments_id_type TEXT;
BEGIN
  SELECT data_type
    INTO payments_id_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'payments'
     AND column_name = 'id';

  IF payments_id_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION
      'payments.id must be UUID for the canonical payment model; found %. Perform an explicit reviewed financial-data migration.',
      COALESCE(payments_id_type, 'missing');
  END IF;

  IF EXISTS (
    SELECT 1 FROM subscriptions
     WHERE user_id IS NULL OR artist_id IS NULL OR type IS NULL OR status IS NULL
  ) THEN
    RAISE EXCEPTION
      'subscriptions contains rows without canonical owner/artist/type/status; clean historical data explicitly before deployment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM transactions
     WHERE user_id IS NULL OR artist_id IS NULL OR amount IS NULL OR currency IS NULL OR status IS NULL
  ) THEN
    RAISE EXCEPTION
      'transactions contains rows incompatible with the Phase-1 artist payment model; migrate historical financial data explicitly';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payments
     WHERE user_id IS NULL OR subscription_id IS NULL OR amount IS NULL OR status IS NULL OR razorpay_payment_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'payments contains incomplete financial rows; migrate historical financial data explicitly';
  END IF;
END $$;

ALTER TABLE subscriptions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN artist_id SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN type SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN status SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN artist_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN amount SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN currency SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;
ALTER TABLE payments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN subscription_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN amount SET NOT NULL;
ALTER TABLE payments ALTER COLUMN status SET NOT NULL;
ALTER TABLE payments ALTER COLUMN razorpay_payment_id SET NOT NULL;
