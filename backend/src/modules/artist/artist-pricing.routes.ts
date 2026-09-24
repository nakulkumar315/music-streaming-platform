import { Router } from "express";
import { requireAuth, requireVerifiedArtist } from "../../common/auth/requireAuth";
import { invalidateArtistCache } from "../../common/cache";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";
import type { NormalizedArtistPricingInput } from "./artist-pricing.validation";

const router = Router();
router.use("/pricing", requireAuth, requireVerifiedArtist);

function correlationId(req: any): string {
  return String(req?.correlationId || "-");
}

router.get("/pricing", async (req: any, res: any) => {
  const id = correlationId(req);
  try {
    const result = await pool.query(
      `SELECT subscription_price, yearly_subscription_price,
              COALESCE(subscription_features, '[]'::jsonb) AS subscription_features
         FROM users
        WHERE id = $1 AND UPPER(role) = 'ARTIST'
        LIMIT 1`,
      [Number(req.user?.id)]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        code: "ARTIST_NOT_FOUND",
        message: "Artist not found",
        correlationId: id,
      });
    }
    return res.json({
      success: true,
      subscriptionPrice: Number(row.subscription_price || 0),
      yearlySubscriptionPrice: Number(row.yearly_subscription_price || 0),
      subscriptionFeatures: Array.isArray(row.subscription_features) ? row.subscription_features : [],
      earlyAccessDays: 7,
      correlationId: id,
    });
  } catch (error) {
    logger.error({ error, correlationId: id, artistId: req.user?.id }, "[ArtistPricing] Read failed");
    return res.status(500).json({
      success: false,
      code: "ARTIST_PRICING_FETCH_FAILED",
      message: "Failed to fetch pricing",
      correlationId: id,
    });
  }
});

router.patch("/pricing", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = Number(req.user?.id);
  const input = req.body as NormalizedArtistPricingInput;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT subscription_price, yearly_subscription_price,
              COALESCE(subscription_features, '[]'::jsonb) AS subscription_features
         FROM users
        WHERE id = $1 AND UPPER(role) = 'ARTIST'
        FOR UPDATE`,
      [artistId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      const error: any = new Error("Artist not found");
      error.status = 404;
      error.code = "ARTIST_NOT_FOUND";
      throw error;
    }

    const nextYearly = input.yearlySubscriptionPrice ?? Number(current.yearly_subscription_price || 0);
    const nextFeatures = input.subscriptionFeatures ??
      (Array.isArray(current.subscription_features) ? current.subscription_features : []);

    await client.query(
      `UPDATE users
          SET subscription_price = $2,
              yearly_subscription_price = $3,
              subscription_features = $4::jsonb,
              updated_at = now()
        WHERE id = $1 AND UPPER(role) = 'ARTIST'`,
      [artistId, input.subscriptionPrice, nextYearly, JSON.stringify(nextFeatures)]
    );

    await AuditService.logCritical(
      {
        action: "artist.pricing_updated",
        entity: "user",
        entityId: String(artistId),
        performedBy: artistId,
        role: "artist",
        status: "success",
        correlationId: id,
        metadata: {
          previous: {
            subscriptionPrice: Number(current.subscription_price || 0),
            yearlySubscriptionPrice: Number(current.yearly_subscription_price || 0),
            featureCount: Array.isArray(current.subscription_features)
              ? current.subscription_features.length
              : 0,
          },
          next: {
            subscriptionPrice: input.subscriptionPrice,
            yearlySubscriptionPrice: nextYearly,
            featureCount: nextFeatures.length,
          },
        },
      },
      client
    );

    await client.query("COMMIT");
    await invalidateArtistCache();
    return res.json({ success: true, correlationId: id });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    const status = error?.status === 404 ? 404 : 500;
    logger.error(
      { error, correlationId: id, artistId, code: error?.code || "ARTIST_PRICING_UPDATE_FAILED" },
      "[ArtistPricing] Update failed"
    );
    return res.status(status).json({
      success: false,
      code: error?.code || "ARTIST_PRICING_UPDATE_FAILED",
      message: status === 404 ? "Artist not found" : "Failed to update pricing",
      correlationId: id,
    });
  } finally {
    client.release();
  }
});

export default router;
