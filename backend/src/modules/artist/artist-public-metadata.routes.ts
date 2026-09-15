import { Router } from "express";
import { pool } from "../../common/db";

const router = Router();

function correlationId(req: any): string {
  return String(req?.correlationId || "-");
}

router.get("/commission-plans", async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT id, version, artist_share, platform_share, effective_from, is_active
         FROM revenue_share_configs
        WHERE is_active = TRUE
        ORDER BY effective_from DESC, id DESC`
    );

    return res.json({
      success: true,
      plans: result.rows.map((row: any) => ({
        id: row.id,
        version: String(row.version),
        name: `Plan ${String(row.version)}`,
        description: "",
        benefits: [],
        artistShare: Number(row.artist_share),
        platformShare: Number(row.platform_share),
        effectiveFrom: row.effective_from,
        isActive: Boolean(row.is_active),
      })),
      correlationId: correlationId(req),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      code: "COMMISSION_PLANS_UNAVAILABLE",
      message: "Failed to fetch commission plans",
      correlationId: correlationId(req),
    });
  }
});

router.get("/terms/current", async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT version, content, effective_from, is_active
         FROM terms_versions
        WHERE is_active = TRUE
        ORDER BY effective_from DESC NULLS LAST, created_at DESC
        LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        code: "ACTIVE_TERMS_NOT_FOUND",
        message: "No active terms found",
        correlationId: correlationId(req),
      });
    }

    return res.json({
      success: true,
      terms: {
        version: String(row.version),
        content: String(row.content),
        effectiveFrom: row.effective_from,
        isActive: Boolean(row.is_active),
      },
      correlationId: correlationId(req),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      code: "TERMS_UNAVAILABLE",
      message: "Failed to fetch terms",
      correlationId: correlationId(req),
    });
  }
});

export default router;
