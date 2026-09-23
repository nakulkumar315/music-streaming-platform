import type { PoolClient } from "pg";
import { pool } from "../db";
import { AuditService } from "../../shared/audit/audit.service";

export type ArtistAccountState = {
  id: number;
  status: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletionReason: string | null;
  sessionsRevoked: number;
  operation: "soft_delete" | "reactivate" | "suspend" | "activate" | "ban";
};

export type ArtistAccountStateAudit = {
  actorId: number;
  actorRole?: "admin" | "moderator" | "system";
  correlationId?: string;
  reason?: string;
};

type AccountStateError = Error & {
  status?: number;
  code?: string;
};

type LockedArtist = {
  id: number;
  status: string;
  is_deleted: boolean;
  deleted_at: Date | null;
  deletion_reason: string | null;
};

function accountStateError(message: string, status: number, code: string): AccountStateError {
  const error = new Error(message) as AccountStateError;
  error.status = status;
  error.code = code;
  return error;
}

async function lockArtist(client: PoolClient, artistId: number): Promise<LockedArtist> {
  const result = await client.query<LockedArtist>(
    `SELECT id, status, is_deleted, deleted_at, deletion_reason
       FROM users
      WHERE id = $1
        AND UPPER(role) = 'ARTIST'
      FOR UPDATE`,
    [artistId]
  );

  const artist = result.rows[0];
  if (!artist) {
    throw accountStateError("Artist not found", 404, "ARTIST_NOT_FOUND");
  }
  return artist;
}

async function revokeArtistSessions(client: PoolClient, artistId: number) {
  const deleted = await client.query(
    "DELETE FROM user_sessions WHERE user_id = $1 RETURNING id",
    [artistId]
  );
  return Number(deleted.rowCount ?? 0);
}

function mapState(
  row: LockedArtist,
  sessionsRevoked: number,
  operation: ArtistAccountState["operation"]
): ArtistAccountState {
  return {
    id: Number(row.id),
    status: String(row.status || ""),
    isDeleted: row.is_deleted === true,
    deletedAt: row.deleted_at ?? null,
    deletionReason: row.deletion_reason ?? null,
    sessionsRevoked,
    operation,
  };
}

async function writeStateAudit(
  client: PoolClient,
  before: LockedArtist,
  after: ArtistAccountState,
  audit: ArtistAccountStateAudit | undefined
) {
  if (!audit) return;

  const actorId = Number(audit.actorId);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw accountStateError("Invalid account-state audit actor", 401, "INVALID_AUDIT_ACTOR");
  }

  await AuditService.logCritical(
    {
      action: "admin.artist_status_changed",
      entity: "user",
      entityId: String(after.id),
      performedBy: actorId,
      role: audit.actorRole || "admin",
      status: "success",
      correlationId: audit.correlationId,
      metadata: {
        operation: after.operation,
        previousStatus: String(before.status || ""),
        status: after.status,
        previousIsDeleted: before.is_deleted === true,
        isDeleted: after.isDeleted,
        previousDeletionReason: before.deletion_reason,
        deletionReason: after.deletionReason,
        sessionsRevoked: after.sessionsRevoked,
        ...(audit.reason ? { reason: audit.reason } : {}),
      },
    },
    client
  );
}

async function inArtistStateTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Canonical privileged artist account-state mutations.
 *
 * Every mutation locks the user row before changing account state, deletes all
 * server-side sessions, and (when invoked from a privileged route) persists the
 * corresponding audit row inside the same transaction. Audit failure therefore
 * rolls back both account-state mutation and session revocation.
 */
export class ArtistAccountStateService {
  static async softDelete(
    artistId: number,
    reason: string,
    audit?: ArtistAccountStateAudit
  ): Promise<ArtistAccountState> {
    const deletionReason = String(reason || "").trim();
    if (!deletionReason) {
      throw accountStateError("Deletion reason is required", 400, "DELETION_REASON_REQUIRED");
    }

    return inArtistStateTransaction(async (client) => {
      const before = await lockArtist(client, artistId);
      const updated = await client.query<LockedArtist>(
        `UPDATE users
            SET is_deleted = true,
                deleted_at = now(),
                deletion_reason = $2,
                updated_at = now()
          WHERE id = $1
          RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
        [artistId, deletionReason]
      );
      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      const state = mapState(updated.rows[0], sessionsRevoked, "soft_delete");
      await writeStateAudit(
        client,
        before,
        state,
        audit ? { ...audit, reason: audit.reason || deletionReason } : undefined
      );
      return state;
    });
  }

  static async reactivate(
    artistId: number,
    audit?: ArtistAccountStateAudit
  ): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      const before = await lockArtist(client, artistId);
      const updated = await client.query<LockedArtist>(
        `UPDATE users
            SET status = 'ACTIVE',
                is_deleted = false,
                deleted_at = NULL,
                deletion_reason = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
        [artistId]
      );
      // Reactivation revokes existing sessions and never revives a previously issued JWT.
      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      const state = mapState(updated.rows[0], sessionsRevoked, "reactivate");
      await writeStateAudit(client, before, state, audit);
      return state;
    });
  }

  static async toggleSuspension(
    artistId: number,
    audit?: ArtistAccountStateAudit
  ): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      const before = await lockArtist(client, artistId);
      const currentStatus = String(before.status || "").toUpperCase();
      const isDeleted = before.is_deleted === true;

      if (currentStatus === "BANNED") {
        throw accountStateError(
          "Banned artists must be explicitly reactivated",
          409,
          "ARTIST_BANNED_REACTIVATION_REQUIRED"
        );
      }

      const activating = isDeleted || currentStatus === "SUSPENDED";
      const updated = activating
        ? await client.query<LockedArtist>(
            `UPDATE users
                SET status = 'ACTIVE',
                    is_deleted = false,
                    deleted_at = NULL,
                    deletion_reason = NULL,
                    updated_at = now()
              WHERE id = $1
              RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
            [artistId]
          )
        : await client.query<LockedArtist>(
            `UPDATE users
                SET status = 'SUSPENDED',
                    is_deleted = false,
                    updated_at = now()
              WHERE id = $1
              RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
            [artistId]
          );

      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      const state = mapState(
        updated.rows[0],
        sessionsRevoked,
        activating ? "activate" : "suspend"
      );
      await writeStateAudit(client, before, state, audit);
      return state;
    });
  }

  static async ban(
    artistId: number,
    audit?: ArtistAccountStateAudit
  ): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      const before = await lockArtist(client, artistId);
      const updated = await client.query<LockedArtist>(
        `UPDATE users
            SET status = 'BANNED',
                updated_at = now()
          WHERE id = $1
          RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
        [artistId]
      );
      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      const state = mapState(updated.rows[0], sessionsRevoked, "ban");
      await writeStateAudit(client, before, state, audit);
      return state;
    });
  }
}
