import { Response } from "express";
import Razorpay from "razorpay";
import { pool } from "../common/db";
import { logger } from "../common/logger";
import { AuditService } from "../shared/audit/audit.service";
import { NotificationService } from "../shared/notifications/notification.service";
import {
  PaymentDomainError,
  finalizeCapturedPayment,
  markPaymentFailed,
} from "../modules/payment/payment.service";
import { startArtistSubscriptionPurchase } from "../modules/payment/payment.purchase.service";
import { processVerifiedRefundEvent } from "../modules/payment/payment.refund.webhook";
import {
  deriveWebhookEventId,
  parseVerifiedWebhookPayload,
  verifyWebhookSignature,
} from "../modules/payment/payment.security";

const getRazorpayClient = () => {
  const keyId = String(process.env.RAZORPAY_KEY_ID ?? "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET ?? "").trim();

  if (!keyId || !keySecret) {
    throw new PaymentDomainError(
      500,
      "PAYMENT_CONFIGURATION_ERROR",
      "Payment gateway is not configured"
    );
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

function sendDomainError(res: Response, error: unknown, fallback: string) {
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
    code: "PAYMENT_OPERATION_FAILED",
    message: fallback,
  });
}

function normalizeCurrency(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

/**
 * POST /api/v1/fan/subscriptions
 *
 * Phase-1 canonical purchase command. The fan sends only artistId. Price,
 * currency, billing period and artist identity are server-authoritative.
 * The subscription remains PENDING until a verified Razorpay webhook succeeds.
 */
export const createSubscriptionPurchase = async (req: any, res: Response) => {
  try {
    const userId = Number(req.user?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const razorpay = getRazorpayClient();
    const purchase = await startArtistSubscriptionPurchase(
      userId,
      req.body?.artistId,
      async (intent) => {
        const order = await razorpay.orders.create({
          amount: intent.amountPaise,
          currency: intent.currency,
          receipt: `artist_sub_${userId}_${intent.artistId}_${Date.now()}`,
          notes: {
            user_id: String(userId),
            artist_id: String(intent.artistId),
            subscription_type: "ARTIST",
            billing_cycle: "monthly",
            authoritative_amount_paise: String(intent.amountPaise),
          },
        });

        return {
          id: String(order.id),
          amount: order.amount,
          currency: String(order.currency || intent.currency),
        };
      }
    );

    logger.info(
      {
        userId,
        subscriptionId: purchase.subscriptionId,
        artistId: purchase.artistId,
        orderId: purchase.orderId,
        amountPaise: purchase.amountPaise,
        reused: purchase.reused,
      },
      "[PAYMENT] Artist subscription checkout prepared"
    );

    return res.status(purchase.reused ? 200 : 201).json({
      success: true,
      subscription: {
        id: purchase.subscriptionId,
        artistId: purchase.artistId,
        artistName: purchase.artistName,
        status: "PENDING",
      },
      order: {
        id: purchase.orderId,
        amount: purchase.amountPaise,
        currency: purchase.currency,
        key_id: String(process.env.RAZORPAY_KEY_ID ?? ""),
      },
      reused: purchase.reused,
    });
  } catch (error) {
    return sendDomainError(res, error, "Failed to start subscription purchase");
  }
};

/**
 * GET /api/v1/fan/subscriptions/:id
 *
 * Polling endpoint used after checkout. It never activates entitlement itself;
 * it only reports the local state established by verified webhook processing.
 */
export const getSubscriptionPurchaseStatus = async (req: any, res: Response) => {
  try {
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

    await pool.query(
      `UPDATE subscriptions
       SET status = 'EXPIRED', updated_at = now()
       WHERE id = $1 AND user_id = $2
         AND UPPER(COALESCE(status, '')) = 'ACTIVE'
         AND next_billing_date IS NOT NULL
         AND next_billing_date <= now()`,
      [subscriptionId, userId]
    );

    const subResult = await pool.query(
      `SELECT s.id, s.user_id, s.artist_id, s.status, s.plan_type,
              s.start_date, s.next_billing_date,
              a.name AS artist_name
       FROM subscriptions s
       JOIN users a ON a.id = s.artist_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.type = 'ARTIST'
       LIMIT 1`,
      [subscriptionId, userId]
    );
    const subscription = subResult.rows?.[0];

    if (!subscription) {
      return res.status(404).json({
        success: false,
        code: "SUBSCRIPTION_NOT_FOUND",
        message: "Subscription not found",
      });
    }

    const txResult = await pool.query(
      `SELECT status, razorpay_order_id, razorpay_payment_id, failure_reason,
              amount, currency, created_at, payment_confirmed_at
       FROM transactions
       WHERE user_id = $1 AND artist_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, subscription.artist_id]
    );
    const transaction = txResult.rows?.[0] ?? null;

    return res.json({
      success: true,
      subscription: {
        id: Number(subscription.id),
        artistId: Number(subscription.artist_id),
        artistName: String(subscription.artist_name || "Artist"),
        status: String(subscription.status || "PENDING").toUpperCase(),
        planType: "MONTHLY",
        startedAt: subscription.start_date,
        expiresAt: subscription.next_billing_date,
      },
      payment: transaction
        ? {
            status: String(transaction.status || "PENDING").toUpperCase(),
            amount: Number(transaction.amount),
            currency: normalizeCurrency(transaction.currency || "INR"),
            orderId: transaction.razorpay_order_id,
            paymentId: transaction.razorpay_payment_id || null,
            failureReason: transaction.failure_reason || null,
            createdAt: transaction.created_at,
            confirmedAt: transaction.payment_confirmed_at || null,
          }
        : null,
    });
  } catch (error) {
    return sendDomainError(res, error, "Failed to fetch subscription status");
  }
};

/**
 * Razorpay webhook. Exact raw bytes are verified before parsing. This is the
 * only Phase-1 path allowed to move a paid subscription from PENDING to ACTIVE.
 */
export const razorpayWebhook = async (req: any, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  let eventId = "unknown";

  try {
    if (!rawBody) {
      return res.status(400).json({
        success: false,
        code: "RAW_WEBHOOK_BODY_REQUIRED",
        message: "Webhook body must be raw application/json bytes",
      });
    }

    const signature = String(req.headers["x-razorpay-signature"] ?? "").trim();
    if (!signature) {
      return res.status(400).json({
        success: false,
        code: "WEBHOOK_SIGNATURE_REQUIRED",
        message: "Webhook signature is required",
      });
    }

    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      logger.warn(
        {
          remoteIP: req.ip,
          userAgent: req.headers["user-agent"],
          tags: ["ALERT", "SECURITY"],
        },
        "[WEBHOOK] Razorpay signature verification failed"
      );
      return res.status(400).send("Invalid signature");
    }

    const payload = parseVerifiedWebhookPayload(rawBody);
    const providerEventHeader = req.headers["x-razorpay-event-id"];
    const providerEventId = String(
      Array.isArray(providerEventHeader)
        ? providerEventHeader[0] ?? ""
        : providerEventHeader ?? ""
    ).trim();
    eventId = providerEventId || deriveWebhookEventId(rawBody, payload);
    const eventType = String(payload.event || "");

    const client = await pool.connect();
    let postCommitNotification:
      | { kind: "PAYMENT_SUCCESS"; userId: number; artistName: string }
      | { kind: "REFUND_SUCCESS"; userId: number }
      | null = null;

    try {
      await client.query("BEGIN");

      const eventInsert = await client.query(
        `INSERT INTO processed_webhook_events (event_id, provider, created_at)
         VALUES ($1, 'razorpay', now())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );

      if (eventInsert.rowCount === 0) {
        await client.query("COMMIT");
        return res.json({ success: true, duplicated: true });
      }

      switch (eventType) {
        case "payment.captured": {
          const entity = payload?.payload?.payment?.entity;
          const orderId = String(entity?.order_id ?? "").trim();
          const paymentId = String(entity?.id ?? "").trim();
          const amountPaise = Number(entity?.amount);
          const currency = normalizeCurrency(entity?.currency);

          if (
            !orderId ||
            !paymentId ||
            !Number.isSafeInteger(amountPaise) ||
            amountPaise <= 0 ||
            !currency
          ) {
            throw new PaymentDomainError(
              400,
              "INVALID_CAPTURE_EVENT",
              "Captured payment event is missing required fields"
            );
          }

          const finalized = await finalizeCapturedPayment(client, {
            orderId,
            paymentId,
            providerAmountPaise: amountPaise,
            providerCurrency: currency,
            confirmedAt: entity?.created_at
              ? new Date(Number(entity.created_at) * 1000)
              : new Date(),
          });

          postCommitNotification = {
            kind: "PAYMENT_SUCCESS",
            userId: finalized.userId,
            artistName: finalized.artistName,
          };
          break;
        }

        case "payment.failed": {
          const entity = payload?.payload?.payment?.entity;
          const orderId = String(entity?.order_id ?? "").trim();
          if (orderId) {
            await markPaymentFailed(client, {
              orderId,
              paymentId: entity?.id ? String(entity.id) : undefined,
              reason:
                entity?.error_description ||
                entity?.error_reason ||
                "Gateway payment failed",
            });
          }
          break;
        }

        case "refund.created":
        case "refund.processed":
        case "refund.failed": {
          const entity = payload?.payload?.refund?.entity;
          const paymentId = String(entity?.payment_id ?? "").trim();
          const refundId = String(entity?.id ?? "").trim();
          const refundAmountPaise = Number(entity?.amount);
          const fallbackStatus =
            eventType === "refund.processed"
              ? "processed"
              : eventType === "refund.failed"
                ? "failed"
                : "pending";
          const providerStatus = String(entity?.status || fallbackStatus).toLowerCase();

          if (
            !paymentId ||
            !refundId ||
            !Number.isSafeInteger(refundAmountPaise) ||
            refundAmountPaise <= 0
          ) {
            throw new PaymentDomainError(
              400,
              "INVALID_REFUND_EVENT",
              "Refund event is missing required fields"
            );
          }

          const refund = await processVerifiedRefundEvent(client, {
            paymentId,
            refundId,
            refundAmountPaise,
            providerStatus,
            currency: normalizeCurrency(entity?.currency || "INR"),
          });

          if (refund.fullRefund) {
            postCommitNotification = {
              kind: "REFUND_SUCCESS",
              userId: refund.userId,
            };
          }
          break;
        }

        default:
          logger.info({ eventId, eventType }, "[WEBHOOK] Verified event ignored");
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (postCommitNotification?.kind === "PAYMENT_SUCCESS") {
      NotificationService.sendToUser({
        userId: String(postCommitNotification.userId),
        title: "Subscription Active! ✅",
        body: `Your subscription to ${postCommitNotification.artistName} is now active.`,
        data: { type: "subscription_active" },
      }).catch((error) =>
        logger.error({ error, eventId }, "[WEBHOOK] Success notification failed")
      );
    } else if (postCommitNotification?.kind === "REFUND_SUCCESS") {
      NotificationService.sendToUser({
        userId: String(postCommitNotification.userId),
        title: "Refund Completed",
        body: "Your refund was completed and subscription access has been updated.",
        data: { type: "refund_completed" },
      }).catch((error) =>
        logger.error({ error, eventId }, "[WEBHOOK] Refund notification failed")
      );
    }

    AuditService.log({
      action: `razorpay.${eventType || "event"}`,
      entity: "payment_webhook",
      entityId: eventId,
      role: "system",
      status: "success",
      metadata: { provider: "razorpay", event_type: eventType },
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.error(
      {
        error,
        eventId,
        tags: ["ALERT", "PAYMENT_FAILURE"],
      },
      "[WEBHOOK] Razorpay event processing failed"
    );

    AuditService.log({
      action: "webhook.failed",
      entity: "payment_webhook",
      entityId: eventId,
      role: "system",
      status: "failed",
      metadata: {
        provider: "razorpay",
        error_code:
          error instanceof PaymentDomainError
            ? error.code
            : "WEBHOOK_PROCESSING_FAILED",
      },
    });

    if (error instanceof PaymentDomainError && error.statusCode === 400) {
      return res.status(400).send(error.message);
    }

    return res.status(500).send("Internal Server Error");
  }
};
