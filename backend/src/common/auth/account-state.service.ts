import { pool } from "../db";

export type ArtistAccountState = {
  id: number;
  status: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletionReason: string | null;
  sessionsRevoked: number;
  operation: "soft_delete" | "reactivate" | "suspend" | "activate" | "ban";
};

type AccountStateError = Error & {
  status?: number;
  code?: string;
};

function accountStateError(message: string, status: number, code: string): AccountStateError {
  const error = new Error(message) as AccountStateError;
  error.status = status;
  error.code = code;
  return error;
}

async function lockArtist(client: any, artistId: number) {
  const result = await client.query(
    `SELECT id, status, is_deleted, deleted_at, deletion_reason
       FROM users
      WHERE id = $1
        AND UPPER(role) = 'ARTIST'
      FOR UPDATE`,
    [artistId]
  );

  const artist = result.rows?.[0];
  if (!artist) {
    throw accountStateError("Artist not found", 404, "ARTIST_NOT_FOUND");
  }
  return artist;
}

async function revokeArtistSessions(client: any, artistId: number) {
  const deleted = await client.query(
    "DELETE FROM user_sessions WHERE user_id = $1 RETURNING id",
    [artistId]
  );
  return Number(deleted.rowCount ?? 0);
}

function mapState(row: any, sessionsRevoked: number, operation: ArtistAccountState["operation"]): ArtistAccountState {
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

async function inArtistStateTransaction<T>(work: (client: any) => Promise<T>): Promise<T> {
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
 * Every mutation locks the user row before changing account state and deletes
 * all server-side sessions in the same transaction. This gives the same lock
 * ordering as login/password rotation and prevents an old JWT from becoming
 * valid again after a later reactivation.
 */
export class ArtistAccountStateService {
  static async softDelete(artistId: number, reason: string): Promise<ArtistAccountState> {
    const deletionReason = String(reason || "").trim();
    if (!deletionReason) {
      throw accountStateError("Deletion reason is required", 400, "DELETION_REASON_REQUIRED");
    }

    return inArtistStateTransaction(async (client) => {
      await lockArtist(client, artistId);
      const updated = await client.query(
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
      return mapState(updated.rows[0], sessionsRevoked, "soft_delete");
    });
  }

  static async reactivate(artistId: number): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      await lockArtist(client, artistId);
      const updated = await client.query(
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
      // Purge any stale historical rows as part of reactivation. Reactivation
      // never revives a previously issued JWT; the artist must authenticate again.
      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      return mapState(updated.rows[0], sessionsRevoked, "reactivate");
    });
  }

  static async toggleSuspension(artistId: number): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      const artist = await lockArtist(client, artistId);
      const currentStatus = String(artist.status || "").toUpperCase();
      const isDeleted = artist.is_deleted === true;

      if (currentStatus === "BANNED") {
        throw accountStateError(
          "Banned artists must be explicitly reactivated",
          409,
          "ARTIST_BANNED_REACTIVATION_REQUIRED"
        );
      }

      const activating = isDeleted || currentStatus === "SUSPENDED";
      const updated = activating
        ? await client.query(
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
        : await client.query(
            `UPDATE users
                SET status = 'SUSPENDED',
                    is_deleted = false,
                    updated_at = now()
              WHERE id = $1
              RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
            [artistId]
          );

      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      return mapState(updated.rows[0], sessionsRevoked, activating ? "activate" : "suspend");
    });
  }

  static async ban(artistId: number): Promise<ArtistAccountState> {
    return inArtistStateTransaction(async (client) => {
      await lockArtist(client, artistId);
      const updated = await client.query(
        `UPDATE users
            SET status = 'BANNED',
                updated_at = now()
          WHERE id = $1
          RETURNING id, status, is_deleted, deleted_at, deletion_reason`,
        [artistId]
      );
      const sessionsRevoked = await revokeArtistSessions(client, artistId);
      return mapState(updated.rows[0], sessionsRevoked, "ban");
    });
  }
}
