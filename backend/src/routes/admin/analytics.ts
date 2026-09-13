import { Router, type RequestHandler } from "express";
import { requireAuth } from "../../common/auth/requireAuth";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { getAdminDashboardMetrics } from "../../controllers/adminAnalyticsController";
import { AnalyticsController } from "../../controllers/analyticsController";

const router = Router();
router.get("/metrics", requireAuth, getAdminDashboardMetrics);
router.get("/subscription-health", requireAuth, AnalyticsController.getPlatformSubscriptionHealth);

const requireAdmin = (req: any, res: any, next: any) => {
  if (String(req.user?.role || "").toUpperCase() !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_ANALYTICS_FORBIDDEN",
      message: "Admin role is required",
      correlationId: req?.correlationId || "-",
    });
  }
  return next();
};

type DateRange = { startDate: Date | null; endDate: Date | null };
type SeriesPoint = { date: string; value: number };

function parseOptionalDateRange(req: any, maxDays = 366): DateRange {
  const startRaw = String(req.query?.startDate || "").trim();
  const endRaw = String(req.query?.endDate || "").trim();
  if (!startRaw && !endRaw) return { startDate: null, endDate: null };
  if (!startRaw || !endRaw) throw new Error("startDate and endDate must be provided together");

  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid analytics date range");
  }
  if (startDate > endDate) throw new Error("startDate must not be after endDate");
  const daySpan = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  if (daySpan > maxDays) throw new Error(`Analytics date range must not exceed ${maxDays} days`);
  return { startDate, endDate };
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDays(startDate: Date, endDate: Date) {
  const points: { date: string }[] = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  while (cursor <= end) {
    points.push({ date: toIsoDate(cursor) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

function lastNDays(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return buildDays(start, end);
}

function handler(name: string, fn: (req: any, res: any) => Promise<unknown>): RequestHandler {
  return async (req: any, res: any) => {
    const correlationId = req?.correlationId || "-";
    try {
      await fn(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Admin analytics request failed";
      if (/date range|startDate|endDate/i.test(message)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ANALYTICS_RANGE",
          message,
          correlationId,
        });
      }
      logger.error({ error, name, correlationId }, "[AdminAnalytics] Query failed");
      return res.status(500).json({
        success: false,
        code: "ADMIN_ANALYTICS_FAILED",
        message: "Failed to load analytics",
        correlationId,
      });
    }
  };
}

async function revenueSeries(startIso: string, endIso?: string): Promise<SeriesPoint[]> {
  const params: string[] = [startIso];
  const endPredicate = endIso ? " AND created_at <= $2" : "";
  if (endIso) params.push(endIso);
  const result = await pool.query<SeriesPoint>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
            COALESCE(SUM(amount), 0)::numeric / 100 AS value
       FROM payments
      WHERE created_at >= $1${endPredicate}
        AND UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')
      GROUP BY 1
      ORDER BY 1 ASC`,
    params
  );
  return result.rows;
}

router.get(
  "/dashboard-data",
  requireAuth,
  requireAdmin,
  handler("dashboard-data", async (_req, res) => {
    const today = startOfTodayUtc();
    const days = lastNDays(7);
    const startIso = `${days[0].date}T00:00:00.000Z`;
    const [
      artists,
      reports,
      activeSubscriptions,
      revenueToday,
      newSubscriptionsToday,
      renewalsToday,
      draftsCount,
      failedPaymentsCount,
      growthRows,
      revenueRows,
      drafts,
      failedPayments,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE UPPER(role) = 'ARTIST' AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM content_items WHERE (UPPER(COALESCE(status, '')) = 'FLAGGED' OR COALESCE(report_count, 0) > 0) AND COALESCE(is_taken_down, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM subscriptions WHERE UPPER(status) = 'ACTIVE'"),
      pool.query("SELECT COALESCE(SUM(amount), 0)::numeric / 100 AS value FROM payments WHERE created_at >= $1 AND created_at < ($1::timestamptz + interval '1 day') AND UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')", [today.toISOString()]),
      pool.query("SELECT COUNT(*)::int AS value FROM subscriptions WHERE created_at >= $1 AND created_at < ($1::timestamptz + interval '1 day')", [today.toISOString()]),
      pool.query("SELECT COUNT(*)::int AS value FROM subscriptions WHERE updated_at >= $1 AND updated_at < ($1::timestamptz + interval '1 day') AND created_at < $1", [today.toISOString()]),
      pool.query("SELECT COUNT(*)::int AS value FROM content_items WHERE UPPER(lifecycle_state) = 'DRAFT'"),
      pool.query("SELECT COUNT(*)::int AS value FROM payments WHERE UPPER(status) = 'FAILED'"),
      pool.query<SeriesPoint>("SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS value FROM subscriptions WHERE created_at >= $1 GROUP BY 1 ORDER BY 1 ASC", [startIso]),
      revenueSeries(startIso),
      pool.query("SELECT id, title, created_at FROM content_items WHERE UPPER(lifecycle_state) = 'DRAFT' ORDER BY created_at DESC LIMIT 5"),
      pool.query("SELECT id, amount, created_at, status FROM payments WHERE UPPER(status) = 'FAILED' ORDER BY created_at DESC LIMIT 5"),
    ]);

    const growthMap = new Map(growthRows.rows.map((row) => [row.date, Number(row.value) || 0]));
    const revenueMap = new Map(revenueRows.map((row) => [row.date, Number(row.value) || 0]));
    return res.json({
      success: true,
      summary: {
        totalArtists: Number(artists.rows[0]?.value || 0),
        totalActiveSubscriptions: Number(activeSubscriptions.rows[0]?.value || 0),
        revenueToday: Number(revenueToday.rows[0]?.value || 0),
        activeReports: Number(reports.rows[0]?.value || 0),
        subscriptionDetails: {
          newToday: Number(newSubscriptionsToday.rows[0]?.value || 0),
          renewalsToday: Number(renewalsToday.rows[0]?.value || 0),
        },
        alerts: {
          draftCount: Number(draftsCount.rows[0]?.value || 0),
          failedPaymentsCount: Number(failedPaymentsCount.rows[0]?.value || 0),
        },
      },
      growth: days.map((day) => ({ date: day.date, value: growthMap.get(day.date) ?? 0 })),
      revenue: days.map((day) => ({ date: day.date, value: revenueMap.get(day.date) ?? 0 })),
      alerts: { success: true, drafts: drafts.rows, failedPayments: failedPayments.rows },
    });
  })
);

router.get(
  "/summary",
  requireAuth,
  requireAdmin,
  handler("summary", async (_req, res) => {
    const today = startOfTodayUtc();
    const [artists, reports, activeSubscriptions, revenueToday, drafts, failedPayments] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE UPPER(role) = 'ARTIST' AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM content_items WHERE (UPPER(COALESCE(status, '')) = 'FLAGGED' OR COALESCE(report_count, 0) > 0) AND COALESCE(is_taken_down, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM subscriptions WHERE UPPER(status) = 'ACTIVE'"),
      pool.query("SELECT COALESCE(SUM(amount), 0)::numeric / 100 AS value FROM payments WHERE created_at >= $1 AND created_at < ($1::timestamptz + interval '1 day') AND UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')", [today.toISOString()]),
      pool.query("SELECT COUNT(*)::int AS value FROM content_items WHERE UPPER(lifecycle_state) = 'DRAFT'"),
      pool.query("SELECT COUNT(*)::int AS value FROM payments WHERE UPPER(status) = 'FAILED'"),
    ]);
    return res.json({
      success: true,
      totalArtists: Number(artists.rows[0]?.value || 0),
      totalActiveSubscriptions: Number(activeSubscriptions.rows[0]?.value || 0),
      revenueToday: Number(revenueToday.rows[0]?.value || 0),
      activeReports: Number(reports.rows[0]?.value || 0),
      alerts: {
        draftCount: Number(drafts.rows[0]?.value || 0),
        failedPaymentsCount: Number(failedPayments.rows[0]?.value || 0),
      },
    });
  })
);

router.get(
  "/global-summary",
  requireAuth,
  requireAdmin,
  handler("global-summary", async (req, res) => {
    const { startDate, endDate } = parseOptionalDateRange(req);
    const params = startDate && endDate ? [startDate.toISOString(), endDate.toISOString()] : [];
    const dateSql = startDate && endDate ? " AND created_at >= $1 AND created_at <= $2" : "";
    const [revenue, artists, fans, activeUsers, usersLast30, usersPrev30] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric / 100 AS value FROM payments WHERE UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')${dateSql}`, params),
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE UPPER(role) = 'ARTIST' AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE UPPER(role) = 'FAN' AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE UPPER(role) IN ('FAN', 'ARTIST') AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE created_at >= now() - interval '30 days' AND UPPER(role) IN ('FAN', 'ARTIST') AND COALESCE(is_deleted, false) = false"),
      pool.query("SELECT COUNT(*)::int AS value FROM users WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days' AND UPPER(role) IN ('FAN', 'ARTIST') AND COALESCE(is_deleted, false) = false"),
    ]);
    const recent = Number(usersLast30.rows[0]?.value || 0);
    const previous = Number(usersPrev30.rows[0]?.value || 0);
    const growth = previous > 0 ? ((recent - previous) / previous) * 100 : recent > 0 ? 100 : 0;
    return res.json({
      success: true,
      totalRevenue: Number(revenue.rows[0]?.value || 0),
      totalArtists: Number(artists.rows[0]?.value || 0),
      totalFans: Number(fans.rows[0]?.value || 0),
      totalActiveUsers: Number(activeUsers.rows[0]?.value || 0),
      userGrowthRatePct: Number(growth.toFixed(2)),
      currency: "INR",
    });
  })
);

router.get(
  "/growth",
  requireAuth,
  requireAdmin,
  handler("growth", async (_req, res) => {
    const days = lastNDays(7);
    const startIso = `${days[0].date}T00:00:00.000Z`;
    const result = await pool.query<SeriesPoint>(
      "SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS value FROM subscriptions WHERE created_at >= $1 GROUP BY 1 ORDER BY 1 ASC",
      [startIso]
    );
    const map = new Map(result.rows.map((row) => [row.date, Number(row.value) || 0]));
    return res.json({ success: true, data: days.map((day) => ({ date: day.date, value: map.get(day.date) ?? 0 })) });
  })
);

router.get(
  "/revenue-trends",
  requireAuth,
  requireAdmin,
  handler("revenue-trends", async (req, res) => {
    const { startDate, endDate } = parseOptionalDateRange(req, 90);
    const days = startDate && endDate ? buildDays(startDate, endDate) : lastNDays(30);
    const startIso = `${days[0].date}T00:00:00.000Z`;
    const endIso = endDate ? `${toIsoDate(endDate)}T23:59:59.999Z` : undefined;
    const rows = await revenueSeries(startIso, endIso);
    const map = new Map(rows.map((row) => [row.date, Number(row.value) || 0]));
    return res.json({
      success: true,
      data: days.map((day) => ({ date: day.date, value: map.get(day.date) ?? 0 })),
      currency: "INR",
    });
  })
);

router.get(
  "/top-artists",
  requireAuth,
  requireAdmin,
  handler("top-artists", async (_req, res) => {
    const result = await pool.query<{
      artist_id: number;
      artist_name: string | null;
      profile_image_url: string | null;
      total_subscribers: number;
      total_plays: number;
    }>(
      `SELECT u.id AS artist_id,
              COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS artist_name,
              u.profile_image_url,
              COALESCE(subs.total_subscribers, 0)::int AS total_subscribers,
              COALESCE(plays.total_plays, 0)::int AS total_plays
         FROM users u
         LEFT JOIN (
           SELECT artist_id, COUNT(*)::int AS total_subscribers
             FROM subscriptions
            WHERE UPPER(status) = 'ACTIVE'
              AND artist_id IS NOT NULL
            GROUP BY artist_id
         ) subs ON subs.artist_id = u.id
         LEFT JOIN (
           SELECT c.artist_id, COUNT(p.id)::int AS total_plays
             FROM content_items c
             LEFT JOIN content_plays p
               ON p.content_id = c.id
              AND p.playback_session_id IS NOT NULL
            GROUP BY c.artist_id
         ) plays ON plays.artist_id = u.id
        WHERE UPPER(u.role) = 'ARTIST'
          AND COALESCE(u.is_deleted, false) = false
        ORDER BY total_subscribers DESC, total_plays DESC, u.id ASC
        LIMIT 5`
    );
    return res.json({
      success: true,
      items: result.rows.map((row) => ({
        artistId: Number(row.artist_id),
        name: row.artist_name,
        profileImageUrl: row.profile_image_url,
        subscribers: Number(row.total_subscribers || 0),
        plays: Number(row.total_plays || 0),
      })),
    });
  })
);

router.get(
  "/top-categories",
  requireAuth,
  requireAdmin,
  handler("top-categories", async (_req, res) => {
    const result = await pool.query<{ category: string; value: number }>(
      "SELECT COALESCE(NULLIF(TRIM(type), ''), 'UNKNOWN') AS category, COUNT(*)::int AS value FROM content_items WHERE COALESCE(is_approved, false) = true AND COALESCE(is_taken_down, false) = false GROUP BY 1 ORDER BY value DESC, category ASC LIMIT 8"
    );
    return res.json({
      success: true,
      items: result.rows.map((row) => ({ category: row.category, value: Number(row.value || 0) })),
    });
  })
);

router.get(
  "/revenue",
  requireAuth,
  requireAdmin,
  handler("revenue", async (_req, res) => {
    const days = lastNDays(7);
    const startIso = `${days[0].date}T00:00:00.000Z`;
    const rows = await revenueSeries(startIso);
    const map = new Map(rows.map((row) => [row.date, Number(row.value) || 0]));
    return res.json({
      success: true,
      data: days.map((day) => ({ date: day.date, value: map.get(day.date) ?? 0 })),
      currency: "INR",
    });
  })
);

router.get(
  "/alerts",
  requireAuth,
  requireAdmin,
  handler("alerts", async (_req, res) => {
    const [drafts, failedPayments] = await Promise.all([
      pool.query("SELECT id, title, created_at FROM content_items WHERE UPPER(lifecycle_state) = 'DRAFT' ORDER BY created_at DESC LIMIT 5"),
      pool.query("SELECT id, amount, created_at, status FROM payments WHERE UPPER(status) = 'FAILED' ORDER BY created_at DESC LIMIT 5"),
    ]);
    return res.json({ success: true, drafts: drafts.rows, failedPayments: failedPayments.rows });
  })
);

export default router;
