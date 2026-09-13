import { Router } from "express";
import { pool } from "../../common/db";
import { invalidateArtistCache } from "../../common/cache";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();

function correlationId(req: any) {
  return String(req?.correlationId || "-");
}

function actorId(req: any) {
  return Number(req.user?.id);
}

function artistId(req: any) {
  const value = Number(req.params?.id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function mutationFailure(res: any, req: any, error: unknown, operation: string) {
  const correlation = correlationId(req);
  logger.error({ error, operation, correlationId: correlation, adminId: actorId(req), artistId: req.params?.id }, "[AdminArtistAgreement] Mutation failed");
  return res.status(500).json({
    success: false,
    code: "ARTIST_AGREEMENT_MUTATION_FAILED",
    message: "Failed to update artist agreement",
    correlationId: correlation,
  });
}

router.patch("/:id/approve-agreement", async (req: any, res: any) => {
  const id = artistId(req);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, name, email, agreement_accepted, agreement_status, artist_status
         FROM users
        WHERE id = $1 AND UPPER(role) = 'ARTIST'
        FOR UPDATE`,
      [id]
    );
    const artist = current.rows[0];
    if (!artist) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    if (!artist.agreement_accepted) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, code: "AGREEMENT_NOT_SIGNED", message: "Artist has not signed agreement yet", correlationId: correlation });
    }
    const previous = String(artist.agreement_status || "");
    if (previous === "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "AGREEMENT_ALREADY_ACTIVE", message: "Agreement is already active", correlationId: correlation });
    }
    if (previous === "SUSPENDED" || previous === "TERMINATED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "ILLEGAL_AGREEMENT_TRANSITION", message: "Cannot approve suspended or terminated agreement", correlationId: correlation });
    }

    await client.query(
      `UPDATE users
          SET agreement_status = 'ACTIVE', artist_status = 'APPROVED', updated_at = now()
        WHERE id = $1`,
      [id]
    );
    await AuditService.logCritical({
      action: "artist.agreement_approved",
      entity: "user",
      entityId: String(id),
      performedBy: actorId(req),
      role: "admin",
      status: "success",
      correlationId: correlation,
      metadata: { previousStatus: previous, agreementStatus: "ACTIVE", previousArtistStatus: artist.artist_status, artistStatus: "APPROVED" },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, message: "Agreement approved successfully", agreementStatus: "ACTIVE", artistStatus: "APPROVED", correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return mutationFailure(res, req, error, "agreement.approve");
  } finally {
    client.release();
  }
});

router.patch("/:id/reject-agreement", async (req: any, res: any) => {
  const id = artistId(req);
  const correlation = correlationId(req);
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  const reason = String(req.body?.reason || "No reason provided").trim().slice(0, 500) || "No reason provided";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, agreement_accepted, agreement_status, artist_status
         FROM users
        WHERE id = $1 AND UPPER(role) = 'ARTIST'
        FOR UPDATE`,
      [id]
    );
    const artist = current.rows[0];
    if (!artist) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    if (!artist.agreement_accepted) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, code: "AGREEMENT_NOT_SIGNED", message: "Artist has not signed agreement yet", correlationId: correlation });
    }
    if (String(artist.agreement_status || "") === "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "ACTIVE_AGREEMENT_REJECT_FORBIDDEN", message: "Cannot reject active agreement. Use suspend instead.", correlationId: correlation });
    }

    await client.query(
      `UPDATE users
          SET agreement_status = 'REJECTED',
              artist_status = 'REJECTED',
              admin_remarks = CONCAT(COALESCE(admin_remarks, ''), CASE WHEN COALESCE(admin_remarks, '') = '' THEN '' ELSE E'\n' END, 'Rejection reason: ', $2),
              updated_at = now()
        WHERE id = $1`,
      [id, reason]
    );
    await AuditService.logCritical({
      action: "artist.agreement_rejected",
      entity: "user",
      entityId: String(id),
      performedBy: actorId(req),
      role: "admin",
      status: "success",
      correlationId: correlation,
      metadata: { previousStatus: artist.agreement_status, agreementStatus: "REJECTED", previousArtistStatus: artist.artist_status, artistStatus: "REJECTED", rejectionReason: reason },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, message: "Agreement rejected successfully", agreementStatus: "REJECTED", artistStatus: "REJECTED", correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return mutationFailure(res, req, error, "agreement.reject");
  } finally {
    client.release();
  }
});

router.patch("/:id/agreement-status", async (req: any, res: any) => {
  const id = artistId(req);
  const correlation = correlationId(req);
  const status = String(req.body?.status || "").trim().toUpperCase();
  if (!id) return res.status(400).json({ success: false, code: "INVALID_ARTIST_ID", message: "Invalid id", correlationId: correlation });
  if (!new Set(["ACTIVE", "SUSPENDED", "TERMINATED"]).has(status)) {
    return res.status(400).json({ success: false, code: "INVALID_AGREEMENT_STATUS", message: "Status must be ACTIVE, SUSPENDED, or TERMINATED", correlationId: correlation });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, agreement_accepted, agreement_status
         FROM users
        WHERE id = $1 AND UPPER(role) = 'ARTIST'
        FOR UPDATE`,
      [id]
    );
    const artist = current.rows[0];
    if (!artist) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlation });
    }
    if (!artist.agreement_accepted) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, code: "AGREEMENT_NOT_SIGNED", message: "Artist has not signed agreement yet", correlationId: correlation });
    }

    await client.query("UPDATE users SET agreement_status = $2, updated_at = now() WHERE id = $1", [id, status]);
    await AuditService.logCritical({
      action: "artist.agreement_status_changed",
      entity: "user",
      entityId: String(id),
      performedBy: actorId(req),
      role: "admin",
      status: "success",
      correlationId: correlation,
      metadata: { previousStatus: artist.agreement_status, agreementStatus: status },
    }, client);
    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, message: `Agreement status updated to ${status}`, agreementStatus: status, correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return mutationFailure(res, req, error, "agreement.status");
  } finally {
    client.release();
  }
});

export default router;
