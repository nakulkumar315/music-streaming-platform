import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { getContentForAccess } from "../../shared/security/media-authz.service";
import { isPlaybackSessionActive } from "../../shared/security/playback-session.service";
import { isContentEligibleForPlayback } from "../media/media-policy.service";

const router = Router();
const requireFan = requireRoles("FAN");
const EVENT_TYPES = new Set(["PLAY_STARTED", "PLAY_COMPLETED", "CONTENT_VIEWED"]);
const CONTENT_VIEW_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Engagement ingestion is intentionally best-effort and non-financial.
 * Payment/earnings totals must never depend on this table.
 */
router.post("/event", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.body?.contentId);
  const eventType = String(req.body?.eventType || "").trim().toUpperCase();
  const sessionId = positiveInteger(req.body?.sessionId);

  if (!userId || !contentId || !EVENT_TYPES.has(eventType)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_EVENT",
      message: "A supported eventType and positive contentId are required",
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

    let eventKey: string;
    let persistedSessionId: number | null = null;

    if (eventType === "PLAY_STARTED" || eventType === "PLAY_COMPLETED") {
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          code: "PLAYBACK_SESSION_REQUIRED",
          message: "Playback analytics require sessionId",
          correlationId,
        });
      }
      const active = await isPlaybackSessionActive(sessionId, userId, contentId);
      if (!active) {
        return res.status(403).json({
          success: false,
          code: "PLAYBACK_SESSION_NOT_AUTHORIZED",
          message: "Playback session is invalid, expired, or not owned by this user",
          correlationId,
        });
      }
      persistedSessionId = sessionId;
      eventKey = `session:${sessionId}:${eventType}`;
    } else {
      // Detail-open views have no playback lease. Use a server-time bucket so
      // rapid retries/replays cannot manufacture arbitrary view volume while a
      // later legitimate revisit can still be represented.
      const bucket = Math.floor(Date.now() / CONTENT_VIEW_DEDUPE_WINDOW_MS);
      eventKey = `view:${contentId}:${bucket}`;
    }

    const inserted = await pool.query(
      `INSERT INTO analytics_events
         (event_type, event_key, user_id, content_id, playback_session_id, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, event_key) DO NOTHING
       RETURNING id`,
      [eventType, eventKey, userId, contentId, persistedSessionId]
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
