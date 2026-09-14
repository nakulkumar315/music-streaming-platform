import { pool } from "./index";

export const LATEST_SCHEMA_VERSION = "20260914_0012_adaptive_protected_media";

const REQUIRED_SCHEMA: Record<string, string[]> = {
  users: [
    "id",
    "email",
    "password",
    "role",
    "status",
    "is_deleted",
    "subscription_price",
    "agreement_status",
  ],
  content_items: [
    "id",
    "artist_id",
    "lifecycle_state",
    "is_approved",
    "is_taken_down",
    "status",
    "visibility",
    "subscription_required",
    "storage_provider",
    "storage_key",
    "video_storage_key",
    "thumbnail_storage_key",
    "provider_asset_id",
    "audio_provider_asset_id",
    "video_provider_asset_id",
    "thumbnail_provider_asset_id",
    "release_track_id",
    "adaptive_status",
    "adaptive_qualities",
    "source_width",
    "source_height",
  ],
  releases: [
    "id",
    "artist_id",
    "title",
    "version_subtitle",
    "release_type",
    "primary_genre",
    "secondary_genre",
    "language",
    "explicit",
    "label_name",
    "copyright_text",
    "phonographic_copyright_text",
    "early_access_start_at",
    "public_release_at",
    "exclusivity_end_at",
    "release_phase",
    "distribution_status",
    "upc_ean",
    "artwork_storage_key",
    "artwork_provider_asset_id",
    "source_content_id",
    "version_no",
    "created_at",
    "updated_at",
  ],
  release_tracks: [
    "id",
    "release_id",
    "content_item_id",
    "artist_id",
    "disc_number",
    "track_number",
    "title",
    "version_mix",
    "duration_ms",
    "explicit",
    "isrc",
    "created_at",
    "updated_at",
  ],
  release_contributors: [
    "id",
    "release_id",
    "release_track_id",
    "contributor_user_id",
    "display_name",
    "role",
    "display_order",
    "created_at",
    "updated_at",
  ],
  external_platform_links: [
    "id",
    "release_id",
    "release_track_id",
    "platform_code",
    "external_url",
    "external_platform_id",
    "status",
    "created_at",
    "updated_at",
  ],
  distribution_submissions: [
    "id",
    "release_id",
    "provider_code",
    "idempotency_key",
    "provider_reference",
    "status",
    "metadata_snapshot",
    "attempt_count",
    "submitted_at",
    "last_checked_at",
    "last_error_code",
    "last_error_message",
    "created_at",
    "updated_at",
  ],
  distribution_platform_statuses: [
    "id",
    "submission_id",
    "platform_code",
    "status",
    "external_platform_id",
    "external_url",
    "status_reason",
    "status_at",
    "created_at",
    "updated_at",
  ],
  distribution_outbox: [
    "id",
    "release_id",
    "submission_id",
    "event_key",
    "event_type",
    "payload",
    "status",
    "available_at",
    "attempt_count",
    "processed_at",
    "created_at",
  ],
  content_plays: ["id", "content_id", "user_id", "playback_session_id", "created_at"],
  analytics_events: [
    "id",
    "event_type",
    "event_key",
    "user_id",
    "content_id",
    "playback_session_id",
    "created_at",
  ],
  operational_job_runs: [
    "job_name",
    "window_key",
    "run_token",
    "status",
    "started_at",
    "completed_at",
    "last_error",
  ],
  user_media_assets: [
    "id",
    "user_id",
    "kind",
    "storage_provider",
    "storage_key",
    "provider_asset_id",
    "mime_type",
    "size_bytes",
    "created_at",
    "updated_at",
  ],
  user_sessions: ["id", "user_id", "device_id", "last_active_at"],
  subscriptions: [
    "id",
    "user_id",
    "artist_id",
    "type",
    "status",
    "plan_type",
    "next_billing_date",
    "auto_renew",
    "canceled_at",
  ],
  transactions: [
    "id",
    "user_id",
    "artist_id",
    "amount",
    "currency",
    "status",
    "razorpay_order_id",
    "razorpay_payment_id",
    "refund_amount",
    "refund_status",
  ],
  payments: [
    "id",
    "user_id",
    "subscription_id",
    "amount",
    "status",
    "razorpay_payment_id",
  ],
  refund_requests: [
    "id",
    "payment_id",
    "subscription_id",
    "user_id",
    "razorpay_payment_id",
    "idempotency_key",
    "amount",
    "currency",
    "status",
    "provider_refund_id",
    "provider_status",
    "requested_by",
    "requested_by_role",
    "failure_code",
    "failure_message",
    "provider_snapshot",
    "last_reconciled_at",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  processed_webhook_events: ["event_id", "provider", "created_at"],
  subscription_audit_logs: [
    "id",
    "user_id",
    "subscription_id",
    "event_type",
    "created_at",
  ],
  audit_logs: [
    "id",
    "action",
    "entity",
    "entity_id",
    "actor_id",
    "actor_role",
    "status",
    "correlation_id",
    "metadata",
    "created_at",
  ],
  playback_history: ["id", "user_id", "content_id", "played_at"],
  playback_sessions: [
    "id",
    "user_id",
    "content_id",
    "heartbeat_at",
    "started_at",
    "current_position",
    "duration",
    "ended_at",
    "analytics_heartbeat_at",
    "last_accepted_position",
    "trusted_listened_seconds",
    "last_heartbeat_sequence",
    "play_counted_at",
  ],
  revenue_share_configs: ["id", "version", "artist_share", "platform_share"],
  terms_versions: ["id", "version", "content", "effective_from"],
  playback_progress: [
    "user_id",
    "content_id",
    "position_ms",
    "duration_ms",
    "completed",
    "updated_at",
  ],
};

const REQUIRED_CONSTRAINTS = [
  "fk_content_artist",
  "content_items_lifecycle_state_valid",
  "content_items_technical_status_valid",
  "content_items_approval_state_valid",
  "content_items_visibility_valid",
  "content_items_type_valid",
  "content_items_storage_provider_valid",
  "content_items_media_key_valid",
  "content_items_adaptive_status_valid",
  "content_items_adaptive_qualities_valid",
  "content_items_source_width_positive",
  "content_items_source_height_positive",
  "fk_content_items_release_track",
  "fk_releases_artist",
  "fk_releases_source_content",
  "releases_source_content_unique",
  "releases_id_artist_unique",
  "releases_release_type_valid",
  "releases_release_phase_valid",
  "releases_distribution_status_valid",
  "releases_upc_ean_shape_valid",
  "releases_version_positive",
  "releases_public_after_early_access",
  "releases_exclusivity_after_release_dates",
  "fk_release_tracks_release",
  "fk_release_tracks_content",
  "fk_release_tracks_artist",
  "fk_release_tracks_release_artist",
  "release_tracks_content_unique",
  "release_tracks_order_unique",
  "release_tracks_release_id_id_unique",
  "release_tracks_disc_positive",
  "release_tracks_track_positive",
  "release_tracks_duration_positive",
  "release_tracks_isrc_shape_valid",
  "fk_release_contributors_release",
  "fk_release_contributors_track",
  "fk_release_contributors_release_track",
  "fk_release_contributors_user",
  "release_contributors_role_valid",
  "release_contributors_display_order_nonnegative",
  "fk_external_platform_links_release",
  "fk_external_platform_links_track",
  "fk_external_platform_links_release_track",
  "external_platform_links_status_valid",
  "external_platform_links_url_http",
  "fk_distribution_submissions_release",
  "distribution_submissions_idempotency_unique",
  "distribution_submissions_release_id_id_unique",
  "distribution_submissions_status_valid",
  "distribution_submissions_attempt_nonnegative",
  "fk_distribution_platform_status_submission",
  "distribution_platform_status_unique",
  "distribution_platform_status_valid",
  "distribution_platform_external_url_http",
  "fk_distribution_outbox_release",
  "fk_distribution_outbox_submission",
  "fk_distribution_outbox_release_submission",
  "distribution_outbox_event_key_unique",
  "distribution_outbox_status_valid",
  "distribution_outbox_attempt_nonnegative",
  "fk_user_media_assets_user",
  "user_media_assets_user_kind_unique",
  "user_media_assets_kind_valid",
  "user_media_assets_provider_valid",
  "user_media_assets_size_positive",
  "fk_sessions_user",
  "fk_subscriptions_user",
  "fk_subscriptions_artist",
  "fk_transactions_user",
  "fk_transactions_artist",
  "fk_payments_user",
  "fk_payments_subscription",
  "fk_playback_history_user",
  "fk_playback_history_content",
  "fk_playback_sessions_user",
  "fk_playback_sessions_content",
  "fk_content_plays_playback_session",
  "playback_sessions_last_accepted_position_nonnegative",
  "playback_sessions_trusted_listened_seconds_nonnegative",
  "playback_sessions_last_heartbeat_sequence_nonnegative",
  "analytics_events_event_type_valid",
  "analytics_events_user_event_key_unique",
  "operational_job_runs_pkey",
  "operational_job_runs_status_valid",
  "fk_refund_requests_payment",
  "fk_refund_requests_subscription",
  "fk_refund_requests_user",
  "fk_refund_requests_requested_by",
  "refund_requests_payment_unique",
  "refund_requests_gateway_payment_unique",
  "refund_requests_idempotency_unique",
  "refund_requests_provider_refund_unique",
  "refund_requests_amount_positive",
  "refund_requests_status_valid",
  "refund_requests_requested_by_role_valid",
  "playback_progress_pkey",
  "playback_progress_user_id_fkey",
  "playback_progress_content_id_fkey",
  "playback_progress_position_ms_check",
  "playback_progress_duration_ms_check",
];

const REQUIRED_INDEXES = [
  "idx_playback_progress_user_updated",
  "idx_content_plays_playback_session_unique",
  "idx_analytics_events_content_created",
  "idx_analytics_events_user_created",
  "idx_analytics_events_session",
  "idx_operational_job_runs_started",
  "idx_content_items_release_track_unique",
  "idx_content_items_adaptive_readiness",
  "idx_releases_artist_created",
  "idx_releases_phase",
  "idx_releases_distribution_status",
  "idx_releases_upc_ean_unique",
  "idx_release_tracks_release",
  "idx_release_tracks_isrc_unique",
  "idx_release_contributors_release",
  "idx_release_contributors_track",
  "idx_release_contributors_known_user_role_unique",
  "idx_external_platform_links_scope_unique",
  "idx_distribution_submissions_release",
  "idx_distribution_submissions_status",
  "idx_distribution_submissions_provider_reference_unique",
  "idx_distribution_outbox_pending",
];

export type SchemaReadinessResult = {
  version: string;
  database: string;
  schema: string;
};

/** Verify, but never mutate, the database schema before opening the listener. */
export async function assertDatabaseSchemaReady(): Promise<SchemaReadinessResult> {
  const client = await pool.connect();
  try {
    const identity = await client.query<{ current_database: string; current_schema: string }>(
      "SELECT current_database(), current_schema()"
    );

    const migrationsTable = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`
    );
    if (!migrationsTable.rows[0]?.exists) {
      throw new Error(
        "Database schema is not initialized: schema_migrations is missing. Run `npm run db:migrate` before starting the service."
      );
    }

    const version = await client.query<{ version: string }>(
      `SELECT version
       FROM schema_migrations
       WHERE version = $1
       LIMIT 1`,
      [LATEST_SCHEMA_VERSION]
    );
    if (!version.rows[0]) {
      throw new Error(
        `Database schema is behind application code: required migration ${LATEST_SCHEMA_VERSION} is not applied.`
      );
    }

    const requiredTables = Object.keys(REQUIRED_SCHEMA);
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [requiredTables]
    );

    const actual = new Map<string, Set<string>>();
    for (const row of columns.rows) {
      const set = actual.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      actual.set(row.table_name, set);
    }

    const missing: string[] = [];
    for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
      const tableColumns = actual.get(table);
      if (!tableColumns) {
        missing.push(`table:${table}`);
        continue;
      }
      for (const column of requiredColumns) {
        if (!tableColumns.has(column)) missing.push(`${table}.${column}`);
      }
    }

    const constraints = await client.query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE conname = ANY($1::text[])`,
      [REQUIRED_CONSTRAINTS]
    );
    const actualConstraints = new Set(constraints.rows.map((row) => row.conname));
    for (const constraint of REQUIRED_CONSTRAINTS) {
      if (!actualConstraints.has(constraint)) missing.push(`constraint:${constraint}`);
    }

    const indexQuery = await client.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])`,
      [REQUIRED_INDEXES]
    );
    const actualIndexes = new Set(indexQuery.rows.map((row) => row.indexname));
    for (const idx of REQUIRED_INDEXES) {
      if (!actualIndexes.has(idx)) missing.push(`index:${idx}`);
    }

    const auditTrigger = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_trigger
         WHERE tgname = 'audit_logs_append_only'
           AND NOT tgisinternal
       ) AS exists`
    );
    if (!auditTrigger.rows[0]?.exists) missing.push("trigger:audit_logs_append_only");

    if (missing.length > 0) {
      throw new Error(
        `Database schema is incompatible with this release. Missing: ${missing.join(", ")}. Run migrations and resolve schema drift before starting the service.`
      );
    }

    return {
      version: LATEST_SCHEMA_VERSION,
      database: identity.rows[0]?.current_database ?? "unknown",
      schema: identity.rows[0]?.current_schema ?? "unknown",
    };
  } finally {
    client.release();
  }
}
