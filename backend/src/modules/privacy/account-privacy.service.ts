import bcrypt from "bcrypt";
import crypto from "crypto";
import type { PoolClient } from "pg";

import { pool } from "../../common/db";
import { AuditService } from "../../shared/audit/audit.service";

export type AccountAnonymizationActor = {
  actorId?: number;
  role?: "fan" | "artist" | "admin" | "moderator" | "system";
  correlationId?: string;
};

export type AccountAnonymizationResult = {
  userId: number;
  alreadyAnonymized: boolean;
  sessionsRevoked: number;
  playbackSessionsEnded: number;
  subscriptionRowsPreserved: number;
  profileAssetsQueued: number;
};

type LockedUser = {
  id: number;
  role: string;
  is_deleted: boolean;
  anonymized_at: Date | null;
};

function privacyError(message: string, status: number, code: string) {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function lockUser(client: PoolClient, userId: number): Promise<LockedUser> {
  const result = await client.query<LockedUser>(
    `SELECT id, role, is_deleted, anonymized_at
       FROM users
      WHERE id = $1
      FOR UPDATE`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw privacyError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

/**
 * Irreversible personal-profile anonymization.
 *
 * This is deliberately separate from reversible admin suspension/soft-delete.
 * The stable users.id row is retained so payment, refund, subscription, audit,
 * release and content relationships remain reconcilable. Phase-1 subscriptions
 * are fixed-term and non-recurring, so anonymization must not fabricate a new
 * cancellation state; access is revoked by account/session/playback governance.
 */
export async function anonymizeAccount(
  rawUserId: number,
  reason: string,
  actor: AccountAnonymizationActor = { role: "system" }
): Promise<AccountAnonymizationResult> {
  const userId = positiveInteger(rawUserId);
  const normalizedReason = String(reason || "").trim();
  if (!userId) throw privacyError("Invalid user id", 400, "INVALID_USER_ID");
  if (!normalizedReason) {
    throw privacyError("Anonymization reason is required", 400, "ANONYMIZATION_REASON_REQUIRED");
  }

  const replacementPassword = await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockUser(client, userId);

    if (before.anonymized_at) {
      await client.query("COMMIT");
      return {
        userId,
        alreadyAnonymized: true,
        sessionsRevoked: 0,
        playbackSessionsEnded: 0,
        subscriptionRowsPreserved: 0,
        profileAssetsQueued: 0,
      };
    }

    // Queue provider deletion before removing local profile-asset references.
    // The queue keeps the original provider identity, so retries never depend on
    // whichever storage provider is active when the worker later runs.
    const queued = await client.query(
      `INSERT INTO media_deletion_requests (
         entity_type, entity_id, asset_kind, storage_provider, storage_key,
         provider_asset_id, requested_by
       )
       SELECT 'USER_ASSET', uma.id::text, uma.kind, uma.storage_provider,
              uma.storage_key, uma.provider_asset_id, $2
         FROM user_media_assets uma
        WHERE uma.user_id = $1
       ON CONFLICT (entity_type, entity_id, asset_kind, storage_provider, storage_key)
       DO NOTHING
       RETURNING id`,
      [userId, positiveInteger(actor.actorId)]
    );

    await client.query("DELETE FROM user_media_assets WHERE user_id = $1", [userId]);

    const sessions = await client.query(
      "DELETE FROM user_sessions WHERE user_id = $1 RETURNING id",
      [userId]
    );

    const playback = await client.query(
      `UPDATE playback_sessions
          SET ended_at = COALESCE(ended_at, now()),
              heartbeat_at = now()
        WHERE user_id = $1
          AND ended_at IS NULL
        RETURNING id`,
      [userId]
    );

    // Preserve fixed-term subscription/payment history exactly as captured.
    // The now-inactive/deleted account cannot authenticate, and all live
    // playback leases are terminated, so protected playback access is revoked
    // without rewriting historical financial state.
    const subscriptions = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM subscriptions
        WHERE user_id = $1 OR artist_id = $1`,
      [userId]
    );

    // Keep the stable internal row and all financial/audit/content foreign-key
    // relationships. Only ordinary profile/authentication PII is anonymized.
    // Agreement/signature fields are intentionally untouched until an approved
    // legal retention policy decides their lifecycle.
    await client.query(
      `UPDATE users
          SET email = $2,
              password = $3,
              status = 'INACTIVE',
              is_deleted = true,
              deleted_at = COALESCE(deleted_at, now()),
              deletion_reason = $4,
              anonymized_at = now(),
              anonymization_reason = $4,
              name = NULL,
              phone = NULL,
              bio = NULL,
              profile_image_url = NULL,
              banner_image_url = NULL,
              social_links = NULL,
              artist_bio = NULL,
              portfolio_links = '{}'::text[],
              updated_at = now()
        WHERE id = $1`,
      [
        userId,
        `anonymized+${userId}@privacy.invalid`,
        replacementPassword,
        normalizedReason,
      ]
    );

    await AuditService.logCritical(
      {
        action: "privacy.account_anonymized",
        entity: "user",
        entityId: String(userId),
        performedBy: positiveInteger(actor.actorId) || undefined,
        role: actor.role || "system",
        status: "success",
        correlationId: actor.correlationId,
        metadata: {
          subjectRole: String(before.role || "").toUpperCase(),
          sessionsRevoked: Number(sessions.rowCount || 0),
          playbackSessionsEnded: Number(playback.rowCount || 0),
          subscriptionRowsPreserved: Number(subscriptions.rows[0]?.count || 0),
          profileAssetsQueued: Number(queued.rowCount || 0),
          reason: normalizedReason,
          financialHistoryPreserved: true,
          subscriptionHistoryPreserved: true,
          auditHistoryPreserved: true,
          contentOwnershipPreserved: true,
        },
      },
      client
    );

    await client.query("COMMIT");
    return {
      userId,
      alreadyAnonymized: false,
      sessionsRevoked: Number(sessions.rowCount || 0),
      playbackSessionsEnded: Number(playback.rowCount || 0),
      subscriptionRowsPreserved: Number(subscriptions.rows[0]?.count || 0),
      profileAssetsQueued: Number(queued.rowCount || 0),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
