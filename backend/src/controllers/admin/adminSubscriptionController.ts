import { Request, Response } from "express";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";
import { PaymentDomainError } from "../../modules/payment/payment.service";
import { cancelSubscription } from "../../modules/subscription/subscription.cancellation.service";

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof PaymentDomainError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  logger.error({ error }, fallback);
  return res.status(500).json({
    success: false,
    code: "SUBSCRIPTION_OPERATION_FAILED",
    message: fallback,
  });
}

/**
 * ADMIN cancellation is deliberately separate from refund. Phase-1 purchase
 * uses captured Razorpay payments, not a recurring Razorpay subscription
 * object, so cancellation changes only entitlement state and never fabricates a
 * financial reversal.
 */
export const revokeSubscription = async (req: Request, res: Response) => {
  const subscriptionId = Number(req.params.id);
  const correlationId = (req as any).correlationId || "-";
  const adminUserId = Number((req as any).user?.id);
  const reason = String((req.body as any)?.reason || "").trim();

  try {
    const result = await cancelSubscription(
      subscriptionId,
      { userId: adminUserId, role: "ADMIN" },
      reason
    );

    AuditService.log({
      action: "admin.subscription_cancelled",
      entity: "subscription",
      entityId: String(result.subscriptionId),
      performedBy: adminUserId,
      role: "admin",
      status: "success",
      correlationId,
      metadata: {
        action: "cancelled",
        financial_refund: false,
        entitlement_revoked: true,
        already_cancelled: result.alreadyCancelled,
        reason: reason || null,
      },
    });

    return res.json({
      success: true,
      subscription: {
        id: result.subscriptionId,
        status: result.status,
        cancelledAt: result.cancelledAt,
      },
      alreadyCancelled: result.alreadyCancelled,
      message: "Subscription cancelled without refund",
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, "Failed to cancel subscription");
  }
};

/**
 * Support adjustment may change canonical non-financial timing flags only.
 * Subscription status is controlled by payment/cancellation/expiry/refund state
 * machines and cannot be overwritten here.
 */
export const adjustSubscription = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, next_billing_date, auto_renew } = req.body as any;
  const correlationId = (req as any).correlationId || "-";

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SUBSCRIPTION_ID",
      message: "Subscription id is invalid",
      correlationId,
    });
  }

  if (status !== undefined) {
    return res.status(400).json({
      success: false,
      code: "SUBSCRIPTION_STATUS_MANAGED_BY_STATE_MACHINE",
      message:
        "Subscription status cannot be manually overwritten; use the canonical payment, cancellation, expiry or refund flow",
      correlationId,
    });
  }

  try {
    const updateParts: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (next_billing_date !== undefined) {
      updateParts.push(`next_billing_date = $${i++}`);
      values.push(next_billing_date || null);
    }
    if (typeof auto_renew === "boolean") {
      updateParts.push(`auto_renew = $${i++}`);
      values.push(auto_renew);
    }

    if (updateParts.length === 0) {
      return res.status(400).json({
        success: false,
        code: "NO_UPDATES_PROVIDED",
        message: "No supported updates provided",
        correlationId,
      });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE subscriptions
          SET ${updateParts.join(", ")}, updated_at = now()
        WHERE id = $${i}
        RETURNING id`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Subscription not found",
        correlationId,
      });
    }

    AuditService.log({
      action: "admin.subscription_adjusted",
      entity: "subscription",
      entityId: String(id),
      performedBy: (req as any).user?.id,
      role: "admin",
      status: "success",
      correlationId,
      metadata: {
        next_billing_date: next_billing_date ?? undefined,
        auto_renew: auto_renew ?? undefined,
      },
    });

    return res.json({
      success: true,
      message: "Subscription timing settings updated",
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, "Failed to adjust subscription");
  }
};
