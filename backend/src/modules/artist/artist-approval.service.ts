import { pool } from "../../common/db";
import { AuditService } from "../../shared/audit/audit.service";

export type ArtistApprovalDecision = "APPROVE" | "REJECT";

export type ArtistApprovalResult = {
  artistId: number;
  previousStatus: string;
  status: "APPROVED" | "REJECTED";
  isVerified: boolean;
  reason: string | null;
};

type ArtistApprovalError = Error & {
  status?: number;
  code?: string;
};

function approvalError(message: string, status: number, code: string): ArtistApprovalError {
  const error = new Error(message) as ArtistApprovalError;
  error.status = status;
  error.code = code;
  return error;
}

export class ArtistApprovalService {
  static async resolve(input: {
    artistId: number;
    action: ArtistApprovalDecision;
    reason?: string | null;
    actorId: number;
    correlationId?: string;
  }): Promise<ArtistApprovalResult> {
    const artistId = Number(input.artistId);
    if (!Number.isSafeInteger(artistId) || artistId <= 0) {
      throw approvalError("Invalid artist id", 400, "INVALID_ARTIST_ID");
    }

    const actorId = Number(input.actorId);
    if (!Number.isSafeInteger(actorId) || actorId <= 0) {
      throw approvalError("Invalid admin actor", 401, "INVALID_ADMIN_ACTOR");
    }

    const action = input.action;
    if (action !== "APPROVE" && action !== "REJECT") {
      throw approvalError("Invalid approval action", 400, "INVALID_APPROVAL_ACTION");
    }

    const reason = String(input.reason || "").trim();
    if (action === "REJECT" && !reason) {
      throw approvalError("Rejection reason is required", 400, "REJECTION_REASON_REQUIRED");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        `SELECT id, artist_status, status, is_deleted
           FROM users
          WHERE id = $1
            AND UPPER(role) = 'ARTIST'
          FOR UPDATE`,
        [artistId]
      );
      const artist = currentResult.rows?.[0];
      if (!artist) {
        throw approvalError("Artist not found", 404, "ARTIST_NOT_FOUND");
      }

      if (artist.is_deleted === true || String(artist.status || "").toUpperCase() !== "ACTIVE") {
        throw approvalError(
          "Inactive artists cannot be approved or rejected",
          409,
          "ARTIST_ACCOUNT_INACTIVE"
        );
      }

      const previousStatus = String(artist.artist_status || "PENDING").toUpperCase();
      const nextStatus: "APPROVED" | "REJECTED" =
        action === "APPROVE" ? "APPROVED" : "REJECTED";

      if (action === "APPROVE") {
        await client.query(
          `UPDATE users
              SET artist_status = 'APPROVED',
                  is_verified = true,
                  verified = true,
                  admin_remarks = NULL,
                  updated_at = now()
            WHERE id = $1`,
          [artistId]
        );

        await client.query(
          `INSERT INTO artist_stats (
             artist_id, total_plays, total_subscribers, total_earnings, created_at, updated_at
           )
           VALUES ($1, 0, 0, 0, now(), now())
           ON CONFLICT (artist_id) DO NOTHING`,
          [artistId]
        );
      } else {
        await client.query(
          `UPDATE users
              SET artist_status = 'REJECTED',
                  is_verified = false,
                  verified = false,
                  admin_remarks = $2,
                  updated_at = now()
            WHERE id = $1`,
          [artistId, reason]
        );
      }

      await AuditService.logCritical(
        {
          action:
            nextStatus === "APPROVED"
              ? "admin.artist_approved"
              : "admin.artist_rejected",
          entity: "user",
          entityId: String(artistId),
          performedBy: actorId,
          role: "admin",
          status: "success",
          correlationId: input.correlationId,
          metadata: {
            previousStatus,
            nextStatus,
            ...(reason ? { reason } : {}),
          },
        },
        client
      );

      await client.query("COMMIT");
      return {
        artistId,
        previousStatus,
        status: nextStatus,
        isVerified: nextStatus === "APPROVED",
        reason: nextStatus === "REJECTED" ? reason : null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
