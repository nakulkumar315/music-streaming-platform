import { Request, Response } from "express";
import { pool } from "../common/db";
import { logger } from "../common/logger";

function parseDateRange(req: Request) {
  const startRaw = String(req.query.startDate || "").trim();
  const endRaw = String(req.query.endDate || "").trim();
  if (!startRaw && !endRaw) return { startDate: null, endDate: null };
  if (!startRaw || !endRaw) throw new Error("startDate and endDate must be provided together");

  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid analytics date range");
  }
  if (startDate > endDate) throw new Error("startDate must not be after endDate");
  return { startDate, endDate };
}

/**
 * Admin analytics are read-only projections. Financial values are always
 * derived from the canonical captured payment ledger; engagement analytics are
 * never used as a revenue source of truth.
 */
export const getAdminDashboardMetrics = async (req: Request, res: Response) => {
  const correlationId = (req as any)?.correlationId || "-";
  let startDate: Date | null;
  let endDate: Date | null;
  try {
    ({ startDate, endDate } = parseDateRange(req));
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ANALYTICS_RANGE",
      message: error instanceof Error ? error.message : "Invalid analytics date range",
      correlationId,
    });
  }

  try {
    const datePredicate = startDate && endDate ? " AND created_at >= $1 AND created_at <= $2" : "";
    const dateParams = startDate && endDate ? [startDate.toISOString(), endDate.toISOString()] : [];

    const revenueRow = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM payments
        WHERE UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')${datePredicate}`,
      dateParams
    );
    const totalRevenue = Number(revenueRow.rows[0]?.total || 0) / 100;

    const activeSubRow = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM subscriptions
        WHERE UPPER(type) = 'PLATFORM'
          AND UPPER(status) IN ('ACTIVE', 'GRACE')`
    );
    const activeSubscribers = Number(activeSubRow.rows[0]?.count || 0);

    let artistRevenueQuery = `
      SELECT COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS artist_name,
             COALESCE(SUM(p.amount), 0)::numeric AS amount
        FROM payments p
        JOIN subscriptions s ON p.subscription_id = s.id
        JOIN users u ON s.artist_id = u.id
       WHERE UPPER(p.status) IN ('SUCCESS', 'PAID', 'CAPTURED')
         AND UPPER(s.type) = 'ARTIST'`;
    const artistRevenueParams: unknown[] = [];
    if (startDate && endDate) {
      artistRevenueQuery += " AND p.created_at >= $1 AND p.created_at <= $2";
      artistRevenueParams.push(startDate.toISOString(), endDate.toISOString());
    }
    artistRevenueQuery += " GROUP BY u.id, u.name, u.email ORDER BY amount DESC LIMIT 5";

    const artistRevenueRow = await pool.query(artistRevenueQuery, artistRevenueParams);
    const revenuePerArtist = artistRevenueRow.rows.map((row) => ({
      name: row.artist_name,
      revenue: Number(row.amount || 0) / 100,
    }));

    const usersCountRow = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE UPPER(role) = 'FAN' AND COALESCE(is_deleted, false) = false"
    );
    const totalUsers = Number(usersCountRow.rows[0]?.count || 0);
    const conversionRate = totalUsers > 0 ? (activeSubscribers / totalUsers) * 100 : 0;

    let dailyRevenueQuery = `
      SELECT DATE_TRUNC('day', created_at)::date AS date,
             COALESCE(SUM(amount), 0)::numeric AS daily_total
        FROM payments
       WHERE UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')`;
    const dailyRevenueParams: unknown[] = [];
    if (startDate && endDate) {
      dailyRevenueQuery += " AND created_at >= $1 AND created_at <= $2";
      dailyRevenueParams.push(startDate.toISOString(), endDate.toISOString());
    } else {
      dailyRevenueQuery += " AND created_at > now() - interval '30 days'";
    }
    dailyRevenueQuery += " GROUP BY 1 ORDER BY 1 ASC";

    const dailyRevenueRow = await pool.query(dailyRevenueQuery, dailyRevenueParams);
    const dailyTrends = dailyRevenueRow.rows.map((row) => ({
      date: row.date,
      amount: Number(row.daily_total || 0) / 100,
    }));

    const currentMonthRev = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
        FROM payments
       WHERE UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')
         AND created_at >= DATE_TRUNC('month', now())
    `);
    const lastMonthRev = await pool.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
        FROM payments
       WHERE UPPER(status) IN ('SUCCESS', 'PAID', 'CAPTURED')
         AND created_at >= DATE_TRUNC('month', now() - interval '1 month')
         AND created_at < DATE_TRUNC('month', now())
    `);

    const curMonth = Number(currentMonthRev.rows[0]?.total || 0) / 100;
    const prevMonth = Number(lastMonthRev.rows[0]?.total || 0) / 100;
    const momGrowth = prevMonth > 0 ? ((curMonth - prevMonth) / prevMonth) * 100 : 0;
    const arpu = activeSubscribers > 0 ? totalRevenue / activeSubscribers : 0;

    const expiredCountRow = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM subscriptions
        WHERE UPPER(status) = 'EXPIRED'
          AND updated_at > now() - interval '30 days'`
    );
    const expiredLast30 = Number(expiredCountRow.rows[0]?.count || 0);
    const churnRate =
      activeSubscribers > 0
        ? (expiredLast30 / (activeSubscribers + expiredLast30)) * 100
        : 0;

    const recentSubRow = await pool.query(
      `SELECT s.type, u.email AS user_email, u2.name AS artist_name, s.status, s.created_at
         FROM subscriptions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN users u2 ON s.artist_id = u2.id
        ORDER BY s.created_at DESC
        LIMIT 10`
    );

    return res.json({
      success: true,
      metrics: {
        totalRevenue,
        activeSubscribers,
        conversionRate: `${conversionRate.toFixed(2)}%`,
        revenuePerArtist,
        dailyTrends,
        growth: {
          monthlyRevenue: curMonth,
          prevMonthlyRevenue: prevMonth,
          momPercentage: `${momGrowth.toFixed(1)}%`,
        },
        unitEconomics: {
          arpu: Math.round(arpu),
          churnRate: `${churnRate.toFixed(1)}%`,
        },
        recentSubscriptions: recentSubRow.rows,
      },
      currency: "INR",
      correlationId,
    });
  } catch (error) {
    logger.error({ error, correlationId }, "Error fetching admin dashboard metrics");
    return res.status(500).json({
      success: false,
      code: "ADMIN_ANALYTICS_FAILED",
      message: "Failed to fetch admin analytics",
      correlationId,
    });
  }
};
