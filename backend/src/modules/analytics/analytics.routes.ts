import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { getContentForAccess } from "../../shared/security/media-authz.service";
import { isContentEligibleForPlayback } from "../media/media-policy.service";

const router = Router();
const requireFan = requireRoles("FAN");
const CLIENT_EVENT_TYPES = new Set(["CONTENT_VIEWED"]);
const CONTENT_VIEW_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Client analytics ingestion is intentionally limited to non-financial content
 * views. PLAY_STARTED/PLAY_COMPLETED are server-owned playback events so a
 * scripted client cannot manufacture trusted play metrics merely by holding an
 * active lease. Payment/earnings totals never depend on this table.
 */
router.post("/event", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.body?.contentId);
  const eventType = String(req.body?.eventType || "").trim().toUpperCase();

  if (!userId || !contentId || !CLIENT_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_EVENT",
      message: "Client analytics accepts CONTENT_VIEWED with a positive contentId only",
      correlationId,
    });
  }

  try {
    const content = await getContentForAccess(contentId);
    if (
      !content ||
      !isContentEligibleForPlayback({
        technicalStatus: String(content.status || ""),
        lifecycleState: String(content.lifecycle_state || ""),
        isApproved: Boolean(content.is_approved),
        isTakenDown: Boolean(content.is_taken_down),
      })
    ) {
      return res.status(403).json({
        success: false,
        code: "ANALYTICS_CONTENT_NOT_AUTHORIZED",
        message: "Content is not available for analytics",
        correlationId,
      });
    }

    // Detail-open views have no playback lease. Use a server-time bucket so
    // rapid retries/replays cannot manufacture arbitrary view volume while a
    // later legitimate revisit can still be represented.
    const bucket = Math.floor(Date.now() / CONTENT_VIEW_DEDUPE_WINDOW_MS);
    const eventKey = `view:${contentId}:${bucket}`;

    const inserted = await pool.query(
      `INSERT INTO analytics_events
         (event_type, event_key, user_id, content_id, playback_session_id, created_at)
       VALUES ($1, $2, $3, $4, NULL, now())
       ON CONFLICT (user_id, event_key) DO NOTHING
       RETURNING id`,
      [eventType, eventKey, userId, contentId]
    );

    return res.json({
      success: true,
      accepted: (inserted.rowCount ?? 0) > 0,
      duplicate: (inserted.rowCount ?? 0) === 0,
      correlationId,
    });
  } catch (error) {
    // Analytics is explicitly non-blocking. Operational failure is observable,
    // but callers do not lose playback/content UX because telemetry storage is down.
    logger.error(
      { error, correlationId, userId, contentId, eventType },
      "[analytics/event] best-effort persistence failed"
    );
    return res.status(200).json({
      success: true,
      accepted: false,
      duplicate: false,
      degraded: true,
      correlationId,
    });
  }
});

export default router;
