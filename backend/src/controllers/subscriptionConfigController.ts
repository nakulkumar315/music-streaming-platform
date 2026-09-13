import { Request, Response } from "express";
import { pool } from "../common/db";
import { logger } from "../common/logger";

const MAX_FEATURES = 20;
const MAX_FEATURE_LENGTH = 160;

function parseMoney(
  value: unknown,
  field: string,
  required = false
): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return null;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${field} must be a positive amount`);
  }

  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(amount * 100 - paise) > 1e-7) {
    throw new Error(`${field} must use at most two decimal places`);
  }

  return paise / 100;
}

function parsePositiveInteger(value: unknown, field: string, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function normalizeFeatures(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("features must be an array");
  if (value.length > MAX_FEATURES) {
    throw new Error(`features must contain at most ${MAX_FEATURES} items`);
  }

  return value.map((item, index) => {
    const feature = String(item ?? "").trim();
    if (!feature) throw new Error(`features[${index}] must not be empty`);
    if (feature.length > MAX_FEATURE_LENGTH) {
      throw new Error(`features[${index}] is too long`);
    }
    return feature;
  });
}

/**
 * GET /api/v1/subscriptions/platform-config
 * Returns the currently active platform subscription configuration.
 */
export const getPlatformConfig = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT price, yearly_price, discount_price, discount_months, currency, duration, features FROM platform_subscription_configs WHERE is_active = true ORDER BY updated_at DESC LIMIT 1"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform subscription configuration not found",
      });
    }

    return res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    logger.error({ error }, "Error fetching platform subscription config");
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * PUT /api/v1/admin/subscriptions/platform-config
 * Updates the platform subscription configuration. (Admin only)
 *
 * Prices remain expressed in INR rupees at this configuration boundary. The
 * payment domain converts authoritative rupee prices to integer paise before
 * creating gateway orders.
 */
export const updatePlatformConfig = async (req: Request, res: Response) => {
  try {
    const {
      price,
      yearlyPrice,
      discountPrice,
      discountMonths,
      currency,
      duration,
      features,
    } = req.body ?? {};

    let normalizedPrice: number;
    let normalizedYearlyPrice: number | null;
    let normalizedDiscountPrice: number | null;
    let normalizedDiscountMonths: number;
    let normalizedFeatures: string[];

    try {
      normalizedPrice = parseMoney(price, "price", true) as number;
      normalizedYearlyPrice = parseMoney(yearlyPrice, "yearlyPrice");
      normalizedDiscountPrice = parseMoney(discountPrice, "discountPrice");
      normalizedDiscountMonths = parsePositiveInteger(
        discountMonths,
        "discountMonths",
        1
      );
      normalizedFeatures = normalizeFeatures(features);
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SUBSCRIPTION_CONFIG",
        message: error instanceof Error ? error.message : "Invalid subscription configuration",
      });
    }

    const normalizedCurrency = String(currency || "INR").trim().toUpperCase();
    if (normalizedCurrency !== "INR") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SUBSCRIPTION_CONFIG",
        message: "currency must be INR",
      });
    }

    const normalizedDuration = String(duration || "monthly").trim().toLowerCase();
    if (normalizedDuration !== "monthly" && normalizedDuration !== "yearly") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SUBSCRIPTION_CONFIG",
        message: "duration must be monthly or yearly",
      });
    }

    const params = [
      normalizedPrice,
      normalizedYearlyPrice,
      normalizedDiscountPrice,
      normalizedDiscountMonths,
      normalizedCurrency,
      normalizedDuration,
      JSON.stringify(normalizedFeatures),
    ];

    const result = await pool.query(
      `UPDATE platform_subscription_configs
       SET price = $1,
           yearly_price = $2,
           discount_price = $3,
           discount_months = $4,
           currency = $5,
           duration = $6,
           features = $7,
           updated_at = now()
       WHERE is_active = true
       RETURNING *`,
      params
    );

    if (result.rowCount === 0) {
      await pool.query(
        `INSERT INTO platform_subscription_configs
          (price, yearly_price, discount_price, discount_months, currency, duration, features, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        params
      );
    }

    return res.json({
      success: true,
      message: "Platform subscription updated successfully",
    });
  } catch (error) {
    logger.error({ error }, "Error updating platform subscription config");
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
