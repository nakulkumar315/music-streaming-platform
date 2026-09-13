import { pool } from "../../common/db";

function pageValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/**
 * Live content with fan reports, ordered by moderation priority. This query is
 * read-only; all governance mutations stay in content-governance.service.ts.
 */
export async function listReportedLiveContent(rawLimit = 50, rawOffset = 0) {
  const limit = pageValue(rawLimit, 50, 1, 100);
  const offset = pageValue(rawOffset, 0, 0, 100_000);

  const result = await pool.query(
    `SELECT c.id,
            c.title,
            c.type,
            c.genre,
            c.artist_id,
            c.lifecycle_state,
            c.status AS technical_status,
            c.is_approved,
            c.is_taken_down,
            c.report_count,
            c.created_at,
            c.published_at,
            COALESCE(NULLIF(a.name, ''), split_part(a.email, '@', 1)) AS artist_name,
            COALESCE(
              json_agg(
                json_build_object('reason', report_summary.reason, 'count', report_summary.reason_count)
                ORDER BY report_summary.reason_count DESC
              ) FILTER (WHERE report_summary.reason IS NOT NULL),
              '[]'::json
            ) AS reasons
       FROM content_items c
       JOIN users a ON a.id = c.artist_id
       LEFT JOIN (
         SELECT content_id, reason, COUNT(*)::int AS reason_count
           FROM reports
          GROUP BY content_id, reason
       ) report_summary ON report_summary.content_id = c.id
      WHERE c.lifecycle_state = 'EARLY_ACCESS'
        AND c.status = 'READY'
        AND c.is_approved = TRUE
        AND c.is_taken_down = FALSE
        AND c.report_count > 0
      GROUP BY c.id, a.name, a.email
      ORDER BY c.report_count DESC, c.published_at ASC NULLS FIRST, c.id ASC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    title: String(row.title),
    type: String(row.type),
    genre: row.genre ? String(row.genre) : null,
    artist: {
      id: Number(row.artist_id),
      name: row.artist_name ? String(row.artist_name) : null,
    },
    lifecycleState: String(row.lifecycle_state),
    technicalStatus: String(row.technical_status),
    isApproved: row.is_approved === true,
    isTakenDown: row.is_taken_down === true,
    reportCount: Number(row.report_count ?? 0),
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    createdAt: row.created_at,
    publishedAt: row.published_at,
  }));
}
