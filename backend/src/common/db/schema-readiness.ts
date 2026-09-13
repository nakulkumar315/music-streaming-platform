import { pool } from "./index";

export const LATEST_SCHEMA_VERSION = "20260913_0007_content_governance_integrity";

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
  audit_logs: ["id", "action", "entity", "status", "created_at"],
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
  ],
  revenue_share_configs: ["id", "version", "artist_share", "platform_share"],
  terms_versions: ["id", "version", "content", "effective_from"],
};

const REQUIRED_CONSTRAINTS = [
  "fk_content_artist",
  "content_items_lifecycle_state_valid",
  "content_items_technical_status_valid",
  "content_items_approval_state_valid",
  "content_items_visibility_valid",
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
