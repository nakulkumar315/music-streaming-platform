import { Router } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { pool } from "../../common/db";
import {
  createSubscriptionPurchase,
  getSubscriptionPurchaseStatus,
} from "../../controllers/paymentController";
import {
  cancelSubscription,
  toggleAutoRenew,
} from "../../controllers/subscriptionController";
import {
  getUpsellStatus,
  trackUpsellAttempt,
} from "../../controllers/upsellController";

const router = Router();

function positiveInteger(value: unknown): number | null {
  const number = Number(String(value ?? "").trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function expireDueArtistSubscriptions(userId: number): Promise<void> {
  await pool.query(
    `UPDATE subscriptions
     SET status = 'EXPIRED', updated_at = now()
     WHERE user_id = $1
       AND type = 'ARTIST'
       AND UPPER(COALESCE(status, '')) = 'ACTIVE'
       AND next_billing_date IS NOT NULL
       AND next_billing_date <= now()`,
    [userId]
  );
}

function mapSubscription(row: any) {
  const expiry = row.next_billing_date ? new Date(row.next_billing_date) : null;
  const daysLeft = expiry
    ? Math.max(
        0,
        Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      )
    : null;

  return {
    id: Number(row.id),
    type: "ARTIST",
    artist_id: Number(row.artist_id),
    artist_name: String(row.artist_name || "Artist"),
    artist_avatar: row.artist_avatar || null,
    status: String(row.status || "PENDING").toUpperCase(),
    plan_type: "MONTHLY",
    start_date: row.start_date || null,
    next_billing_date: row.next_billing_date || null,
    end_date: row.next_billing_date || null,
    grace_ends_at: null,
    daysLeft,
    isExpiringSoon: daysLeft !== null && daysLeft <= 3,
    auto_renew: false,
    price:
      row.subscription_price !== undefined && row.subscription_price !== null
        ? Number(row.subscription_price)
        : undefined,
    currency: "INR",
    features: Array.isArray(row.subscription_features)
      ? row.subscription_features
      : undefined,
  };
}

/**
 * POST /api/v1/fan/subscriptions
 * Canonical Phase-1 artist subscription purchase command.
 */
router.post("/", requireAuth, (req, res) =>
  createSubscriptionPurchase(req as any, res)
);

/** Current subscription for one artist. */
router.get("/me", requireAuth, async (req: any, res) => {
  const userId = positiveInteger(req.user?.id);
  const artistId = positiveInteger(req.query?.artistId);

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!artistId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ARTIST_ID",
      message: "artistId is required",
    });
  }

  try {
    await expireDueArtistSubscriptions(userId);

    const result = await pool.query(
      `SELECT s.id, s.artist_id, s.status, s.start_date, s.next_billing_date,
              a.name AS artist_name,
              a.profile_image_url AS artist_avatar,
              a.subscription_price,
              a.subscription_features
       FROM subscriptions s
       JOIN users a ON a.id = s.artist_id
       WHERE s.user_id = $1 AND s.artist_id = $2 AND s.type = 'ARTIST'
       LIMIT 1`,
      [userId, artistId]
    );

    const subscription = result.rows?.[0];
    return res.json({
      success: true,
      subscription: subscription ? mapSubscription(subscription) : null,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription",
    });
  }
});

/**
 * Server-authoritative early-access check. The content row decides which artist
 * owns the content; callers cannot gain access by supplying another artist id.
 */
router.get("/access-check", requireAuth, async (req: any, res) => {
  const userId = positiveInteger(req.user?.id);
  const contentId = positiveInteger(req.query?.contentId);

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!contentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CONTENT_ID",
      message: "contentId is required",
    });
  }

  try {
    const contentResult = await pool.query(
      `SELECT id, artist_id, subscription_required
       FROM content_items
       WHERE id = $1
       LIMIT 1`,
      [contentId]
    );
    const content = contentResult.rows?.[0];

    if (!content) {
      return res.status(404).json({
        success: false,
        code: "CONTENT_NOT_FOUND",
        message: "Content not found",
      });
    }

    if (!content.subscription_required) {
      return res.json({ success: true, allowed: true, reason: "FREE" });
    }

    await expireDueArtistSubscriptions(userId);

    const subscriptionResult = await pool.query(
      `SELECT id
       FROM subscriptions
       WHERE user_id = $1
         AND artist_id = $2
         AND type = 'ARTIST'
         AND UPPER(COALESCE(status, '')) = 'ACTIVE'
         AND next_billing_date > now()
       LIMIT 1`,
      [userId, content.artist_id]
    );

    return res.json({
      success: true,
      allowed: subscriptionResult.rows.length > 0,
      reason:
        subscriptionResult.rows.length > 0
          ? "ACTIVE"
          : "NO_ACTIVE_SUBSCRIPTION",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Access check failed",
    });
  }
});

/** Account/home summary for the current artist-subscription model. */
router.get("/summary", requireAuth, async (req: any, res) => {
  const userId = positiveInteger(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    await expireDueArtistSubscriptions(userId);

    const latest = await pool.query(
      `SELECT s.id, s.artist_id, s.status, s.start_date, s.next_billing_date,
              a.name AS artist_name,
              a.profile_image_url AS artist_avatar,
              a.subscription_price,
              a.subscription_features
       FROM subscriptions s
       JOIN users a ON a.id = s.artist_id
       WHERE s.user_id = $1 AND s.type = 'ARTIST'
       ORDER BY
         CASE UPPER(COALESCE(s.status, ''))
           WHEN 'ACTIVE' THEN 1
           WHEN 'PENDING' THEN 2
           ELSE 3
         END,
         s.updated_at DESC
       LIMIT 1`,
      [userId]
    );

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM subscriptions
       WHERE user_id = $1
         AND type = 'ARTIST'
         AND UPPER(COALESCE(status, '')) = 'ACTIVE'
         AND next_billing_date > now()`,
      [userId]
    );

    const artistPlan = latest.rows?.[0]
      ? mapSubscription(latest.rows[0])
      : null;

    return res.json({
      success: true,
      plan: artistPlan,
      artistPlan,
      artistSubCount: Number(count.rows?.[0]?.count ?? 0),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription summary",
    });
  }
});

/** Full account subscription/transaction view. */
router.get("/details", requireAuth, async (req: any, res) => {
  const userId = positiveInteger(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    await expireDueArtistSubscriptions(userId);

    const subscriptions = await pool.query(
      `SELECT s.id, s.artist_id, s.status, s.start_date, s.next_billing_date,
              a.name AS artist_name,
              a.profile_image_url AS artist_avatar,
              a.subscription_price,
              a.subscription_features
       FROM subscriptions s
       JOIN users a ON a.id = s.artist_id
       WHERE s.user_id = $1 AND s.type = 'ARTIST'
       ORDER BY s.updated_at DESC`,
      [userId]
    );

    const transactions = await pool.query(
      `SELECT id, amount, currency, artist_name, artist_id, status,
              billing_cycle, razorpay_order_id, razorpay_payment_id,
              created_at AS date, payment_confirmed_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.json({
      success: true,
      artists: subscriptions.rows.map(mapSubscription),
      transactions: transactions.rows,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription details",
    });
  }
});

router.get("/status", requireAuth, async (req: any, res) => {
  const userId = positiveInteger(req.user?.id);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    await expireDueArtistSubscriptions(userId);

    const result = await pool.query(
      `SELECT s.id, s.artist_id, s.status, s.start_date, s.next_billing_date,
              a.name AS artist_name,
              a.profile_image_url AS artist_avatar,
              a.subscription_price,
              a.subscription_features
       FROM subscriptions s
       JOIN users a ON a.id = s.artist_id
       WHERE s.user_id = $1 AND s.type = 'ARTIST'
       ORDER BY s.updated_at DESC`,
      [userId]
    );

    const artists = result.rows.map(mapSubscription);
    return res.json({
      success: true,
      artists,
      count: artists.filter((item: any) => item.status === "ACTIVE").length,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription status",
    });
  }
});

router.post("/upsell/track", requireAuth, trackUpsellAttempt);
router.get("/upsell/status", requireAuth, getUpsellStatus);

// Explicit fixed-term semantics. No recurring Razorpay mandate exists in Phase 1.
router.patch("/:id/toggle-auto-renew", requireAuth, toggleAutoRenew);
router.post("/:id/cancel", requireAuth, cancelSubscription);

// Keep parameter route after all named routes.
router.get("/:id", requireAuth, (req, res) =>
  getSubscriptionPurchaseStatus(req as any, res)
);

export default router;
