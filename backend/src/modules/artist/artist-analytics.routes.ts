import { Router } from "express";
import { requireAuth, requireVerifiedArtist } from "../../common/auth/requireAuth";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";

const router = Router();
router.use(requireAuth, requireVerifiedArtist);

const PAYMENT_SUCCESS_STATUSES = ["SUCCESS", "PAID", "CAPTURED"] as const;

type DailyPoint = { date: string; value: number };

function parseDays(value: unknown, fallback = 30): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : null;
}

function buildUtcDays(days: number): { points: { date: string }[]; startIso: string } {
  const end = new Date();
  const points: { date: string }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    points.push({ date: d.toISOString().slice(0, 10) });
  }
  return { points, startIso: `${points[0].date}T00:00:00.000Z` };
}

function toInr(paise: unknown): number {
  const value = Number(paise || 0);
  return Number.isFinite(value) ? Number((value / 100).toFixed(2)) : 0;
}

function correlationId(req: any): string {
  return String(req?.correlationId || "-");
}

function actorId(req: any): number {
  return Number(req.user?.id);
}

function sendFailure(res: any, req: any, error: unknown, operation: string) {
  const id = correlationId(req);
  logger.error({ error, correlationId: id, artistId: actorId(req), operation }, "[ArtistAnalytics] Query failed");
  return res.status(500).json({
    success: false,
    code: "ARTIST_ANALYTICS_FAILED",
    message: "Failed to load artist analytics",
    correlationId: id,
  });
}

router.get("/dashboard/summary", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  try {
    const [subscriberResult, playsResult, earningsResult] = await Promise.all([
      pool.query<{ value: number }>(
        `SELECT COUNT(*)::int AS value
           FROM subscriptions
          WHERE artist_id = $1
            AND type = 'ARTIST'
            AND UPPER(status) = 'ACTIVE'`,
        [artistId]
      ),
      pool.query<{ value: number }>(
        `SELECT COUNT(p.id)::int AS value
           FROM content_plays p
           JOIN content_items c ON c.id = p.content_id
          WHERE c.artist_id = $1`,
        [artistId]
      ),
      pool.query<{ value: string | number }>(
        `SELECT COALESCE(SUM(p.amount), 0)::numeric AS value
           FROM payments p
           JOIN subscriptions s ON s.id = p.subscription_id
          WHERE s.artist_id = $1
            AND s.type = 'ARTIST'
            AND UPPER(p.status) = ANY($2::text[])`,
        [artistId, PAYMENT_SUCCESS_STATUSES]
      ),
    ]);

    return res.json({
      success: true,
      stats: {
        subscribers: Number(subscriberResult.rows[0]?.value || 0),
        totalPlays: Number(playsResult.rows[0]?.value || 0),
        // Engagement analytics never determines payout. This is gross captured
        // artist-subscription revenue from the canonical payment ledger only.
        grossEarnings: toInr(earningsResult.rows[0]?.value),
      },
      correlationId: id,
    });
  } catch (error) {
    return sendFailure(res, req, error, "dashboard.summary");
  }
});

router.get("/dashboard/growth", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  const days = parseDays(req.query?.days);
  if (!days) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_RANGE",
      message: "days must be an integer from 1 to 365",
      correlationId: id,
    });
  }

  const metric = String(req.query?.metric || "subscribers").trim().toLowerCase();
  if (!new Set(["subscribers", "plays", "earnings"]).has(metric)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_METRIC",
      message: "metric must be subscribers, plays, or earnings",
      correlationId: id,
    });
  }

  const { points, startIso } = buildUtcDays(days);
  try {
    let rows: DailyPoint[];
    if (metric === "plays") {
      const result = await pool.query<DailyPoint>(
        `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS date,
                COUNT(p.id)::int AS value
           FROM content_plays p
           JOIN content_items c ON c.id = p.content_id
          WHERE c.artist_id = $1
            AND p.created_at >= $2
          GROUP BY 1
          ORDER BY 1 ASC`,
        [artistId, startIso]
      );
      rows = result.rows;
    } else if (metric === "earnings") {
      const result = await pool.query<{ date: string; value: string | number }>(
        `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS date,
                COALESCE(SUM(p.amount), 0)::numeric AS value
           FROM payments p
           JOIN subscriptions s ON s.id = p.subscription_id
          WHERE s.artist_id = $1
            AND s.type = 'ARTIST'
            AND p.created_at >= $2
            AND UPPER(p.status) = ANY($3::text[])
          GROUP BY 1
          ORDER BY 1 ASC`,
        [artistId, startIso, PAYMENT_SUCCESS_STATUSES]
      );
      rows = result.rows.map((row) => ({ date: row.date, value: toInr(row.value) }));
    } else {
      const result = await pool.query<DailyPoint>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS value
           FROM subscriptions
          WHERE artist_id = $1
            AND type = 'ARTIST'
            AND created_at >= $2
          GROUP BY 1
          ORDER BY 1 ASC`,
        [artistId, startIso]
      );
      rows = result.rows;
    }

    const values = new Map(rows.map((row) => [row.date, Number(row.value) || 0]));
    const data = points.map((point) => ({ date: point.date, value: values.get(point.date) ?? 0 }));
    const rawTotal = data.reduce((sum, point) => sum + point.value, 0);
    const total = metric === "earnings" ? Number(rawTotal.toFixed(2)) : rawTotal;

    return res.json({ success: true, metric, days, total, data, correlationId: id });
  } catch (error) {
    return sendFailure(res, req, error, "dashboard.growth");
  }
});

router.get("/dashboard/recent-activity", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  try {
    const result = await pool.query(
      `SELECT s.id, s.created_at,
              COALESCE(u.name, u.email) AS fan_name,
              u.profile_image_url
         FROM subscriptions s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.artist_id = $1
        ORDER BY s.created_at DESC
        LIMIT 10`,
      [artistId]
    );
    const items = result.rows.map((row: any) => ({
      id: row.id,
      fanName: row.fan_name ?? "",
      fanAvatarUrl: row.profile_image_url ?? null,
      createdAt: row.created_at,
    }));
    return res.json({ success: true, items, correlationId: id });
  } catch (error) {
    return sendFailure(res, req, error, "dashboard.recent-activity");
  }
});

router.get("/dashboard/new-plays", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.thumbnail_url, COUNT(p.id)::int AS plays
         FROM content_items c
         LEFT JOIN content_plays p ON p.content_id = c.id
        WHERE c.artist_id = $1
        GROUP BY c.id
        ORDER BY plays DESC, c.created_at DESC
        LIMIT 5`,
      [artistId]
    );
    const items = result.rows.map((row: any) => ({
      contentId: row.id,
      title: row.title,
      artwork: row.thumbnail_url ?? null,
      plays: Number(row.plays ?? 0),
    }));
    return res.json({ success: true, items, correlationId: id });
  } catch (error) {
    return sendFailure(res, req, error, "dashboard.new-plays");
  }
});

router.get("/analytics/content-performance", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  const days = parseDays(req.query?.days);
  if (!days) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_RANGE",
      message: "days must be an integer from 1 to 365",
      correlationId: id,
    });
  }

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  try {
    const result = await pool.query(
      `SELECT c.id, c.title, c.thumbnail_url, COUNT(p.id)::int AS plays
         FROM content_items c
         LEFT JOIN content_plays p
           ON p.content_id = c.id
          AND p.created_at >= $2
        WHERE c.artist_id = $1
        GROUP BY c.id
        ORDER BY plays DESC, c.created_at DESC
        LIMIT 7`,
      [artistId, start.toISOString()]
    );
    const items = result.rows.map((row: any) => ({
      contentId: row.id,
      title: row.title,
      thumbnailUrl: row.thumbnail_url ?? null,
      plays: Number(row.plays ?? 0),
    }));
    return res.json({ success: true, days, items, correlationId: id });
  } catch (error) {
    return sendFailure(res, req, error, "analytics.content-performance");
  }
});

router.get("/analytics/summary", async (req: any, res: any) => {
  const id = correlationId(req);
  const artistId = actorId(req);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 30);
  try {
    const result = await pool.query<{ value: string | number }>(
      `SELECT COALESCE(SUM(p.amount), 0)::numeric AS value
         FROM payments p
         JOIN subscriptions s ON s.id = p.subscription_id
        WHERE s.artist_id = $1
          AND s.type = 'ARTIST'
          AND p.created_at >= $2
          AND UPPER(p.status) = ANY($3::text[])`,
      [artistId, start.toISOString(), PAYMENT_SUCCESS_STATUSES]
    );
    return res.json({
      success: true,
      last30Days: { grossEarnings: toInr(result.rows[0]?.value) },
      correlationId: id,
    });
  } catch (error) {
    return sendFailure(res, req, error, "analytics.summary");
  }
});

export default router;
