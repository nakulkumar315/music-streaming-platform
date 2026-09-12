-- Core referential integrity for production data.
-- These constraints are intentionally validated immediately. Invalid historical
-- rows must be repaired explicitly; production code must not operate on orphaned
-- subscriptions, payments, sessions or playback records.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_artist') THEN
    ALTER TABLE content_items
      ADD CONSTRAINT fk_content_artist FOREIGN KEY (artist_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_user') THEN
    ALTER TABLE user_sessions
      ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_user') THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_artist') THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT fk_subscriptions_artist FOREIGN KEY (artist_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_user') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_artist') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_artist FOREIGN KEY (artist_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_user') THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_subscription') THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_plays_content') THEN
    ALTER TABLE content_plays
      ADD CONSTRAINT fk_content_plays_content FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_content_plays_user') THEN
    ALTER TABLE content_plays
      ADD CONSTRAINT fk_content_plays_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_playback_history_user') THEN
    ALTER TABLE playback_history
      ADD CONSTRAINT fk_playback_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_playback_history_content') THEN
    ALTER TABLE playback_history
      ADD CONSTRAINT fk_playback_history_content FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_playback_sessions_user') THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT fk_playback_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_playback_sessions_content') THEN
    ALTER TABLE playback_sessions
      ADD CONSTRAINT fk_playback_sessions_content FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE;
  END IF;
END $$;
