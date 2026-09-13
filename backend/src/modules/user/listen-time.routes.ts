import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { requireRoles } from "../../common/auth/requireRoles";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";

const router = Router();
const requireFan = requireRoles("FAN");

/**
 * Self-service trusted listening total.
 *
 * The authenticated user id is the only ownership key. Raw playback-session
 * duration, content-play counts and client-reported position are deliberately
 * excluded: only server-bounded heartbeat increments persisted in
 * user_listening_stats can contribute listening time.
 */
router.get("/listen-time", requireAuth, requireFan, async (req: any, res: any) => {
  const correlationId = String(req?.correlationId || "-");
  const userId = Number(req.user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Authentication required",
      correlationId,
    });
  }

  try {
    const result = await pool.query<{ total_seconds: string | number }>(
      `SELECT COALESCE(SUM(total_seconds), 0)::bigint AS total_seconds
         FROM user_listening_stats
        WHERE user_id = $1`,
      [userId]
    );
    const totalSeconds = Math.max(0, Number(result.rows[0]?.total_seconds || 0));
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const formattedTime =
      hours > 0
        ? minutes > 0
          ? `${hours}h ${minutes}m`
          : `${hours}h`
        : `${minutes}m`;

    return res.json({
      success: true,
      totalSeconds,
      totalMinutes,
      formattedTime,
      source: "trusted_heartbeat",
      correlationId,
    });
  } catch (error) {
    logger.error(
      { error, userId, correlationId },
      "[ListenTime] Trusted listening total query failed"
    );
    return res.status(500).json({
      success: false,
      code: "LISTEN_TIME_FAILED",
      message: "Failed to load listening time",
      correlationId,
    });
  }
});

export default router;
