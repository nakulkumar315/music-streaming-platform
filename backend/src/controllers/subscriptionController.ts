import { Response } from "express";
import { pool } from "../common/db";
import { logger } from "../common/logger";
import { AuditService } from "../shared/audit/audit.service";

/**
 * Phase-1 billing is a fixed 30-day artist subscription purchased through the
 * canonical payment flow. It does not auto-renew. This endpoint is retained as
 * an explicit contract response while the mobile account UI is simplified.
 */
export const toggleAutoRenew = async (req: any, res: Response) => {
  const userId = Number(req.user?.id);
  const subscriptionId = Number(req.params?.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SUBSCRIPTION_ID",
      message: "Subscription id is invalid",
    });
  }

  const owned = await pool.query(
    `SELECT id FROM subscriptions
     WHERE id = $1 AND user_id = $2 AND type = 'ARTIST'
     LIMIT 1`,
    [subscriptionId, userId]
  );
  if (owned.rows.length === 0) {
    return res.status(404).json({
      success: false,
      code: "SUBSCRIPTION_NOT_FOUND",
      message: "Subscription not found",
    });
  }

  return res.status(409).json({
    success: false,
    code: "AUTO_RENEW_NOT_SUPPORTED",
    message:
      "Phase-1 artist subscriptions are fixed-term monthly access and do not auto-renew.",
  });
};

/**
 * A fixed-term payment is not cancelled like a recurring mandate. The user
 * retains paid access until expiry; no future charge is scheduled.
 */
export const cancelSubscription = async (req: any, res: Response) => {
  const userId = Number(req.user?.id);
  const subscriptionId = Number(req.params?.id);
  const correlationId = req.correlationId || req.headers?.["x-correlation-id"] || null;

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SUBSCRIPTION_ID",
      message: "Subscription id is invalid",
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, status, next_billing_date, artist_id
       FROM subscriptions
       WHERE id = $1 AND user_id = $2 AND type = 'ARTIST'
       LIMIT 1`,
      [subscriptionId, userId]
    );
    const subscription = result.rows?.[0];

    if (!subscription) {
      return res.status(404).json({
        success: false,
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Subscription not found",
      });
    }

    await pool.query(
      `INSERT INTO subscription_audit_logs
         (user_id, subscription_id, event_type, metadata, created_at)
       VALUES ($1, $2, 'CANCELLATION_REQUESTED_NO_RECURRING_CHARGE', $3, now())`,
      [
        userId,
        subscriptionId,
        {
          reason: req.body?.reason || null,
          feedback: req.body?.feedback || null,
        },
      ]
    );

    AuditService.log({
      action: "artist_sub.cancellation_requested",
      entity: "subscription",
      entityId: String(subscriptionId),
      performedBy: userId,
      role: "fan",
      status: "success",
      correlationId,
      metadata: {
        artist_id: subscription.artist_id,
        recurring_charge_scheduled: false,
      },
    });

    return res.json({
      success: true,
      code: "NO_RECURRING_CHARGE_SCHEDULED",
      message:
        "No future automatic charge is scheduled. Your paid access remains available until its expiry date.",
      subscription: {
        id: subscriptionId,
        status: subscription.status,
        expiresAt: subscription.next_billing_date,
      },
    });
  } catch (error) {
    logger.error(
      { error, userId, subscriptionId, correlationId },
      "[SUBSCRIPTION] Cancellation request failed"
    );
    return res.status(500).json({
      success: false,
      code: "SUBSCRIPTION_OPERATION_FAILED",
      message: "Unable to process subscription request",
    });
  }
};
