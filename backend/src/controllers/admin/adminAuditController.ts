import { Request, Response } from "express";
import { poolRead } from "../../common/db";

function positivePage(value: unknown): number | null {
  const raw = String(value ?? "1").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : null;
}

function boundedLimit(value: unknown): number | null {
  const raw = String(value ?? "50").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function boundedFilter(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export const getAuditLogs = async (req: Request, res: Response) => {
  const page = positivePage(req.query.page);
  const limit = boundedLimit(req.query.limit);
  if (!page || !limit) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PAGINATION",
      message: "page must be 1..100000 and limit must be 1..100",
    });
  }

  const rawFilters = ["action", "entity", "role", "status", "search"] as const;
  for (const key of rawFilters) {
    const raw = req.query[key];
    if (raw !== undefined && raw !== null && raw !== "" && boundedFilter(raw, key === "search" ? 120 : 80) === null) {
      return res.status(400).json({
        success: false,
        code: "INVALID_AUDIT_FILTER",
        message: `${key} is invalid`,
      });
    }
  }

  const action = boundedFilter(req.query.action, 80);
  const entity = boundedFilter(req.query.entity, 80);
  const role = boundedFilter(req.query.role, 80);
  const status = boundedFilter(req.query.status, 80);
  const search = boundedFilter(req.query.search, 120);
  const offset = (page - 1) * limit;

  try {
    let baseQuery = `FROM audit_logs WHERE 1=1`;
    const values: any[] = [];
    let paramIndex = 1;

    if (action) {
      baseQuery += ` AND action = $${paramIndex++}`;
      values.push(action);
    }
    if (entity) {
      baseQuery += ` AND entity = $${paramIndex++}`;
      values.push(entity);
    }
    if (role) {
      baseQuery += ` AND actor_role = $${paramIndex++}`;
      values.push(role);
    }
    if (status) {
      baseQuery += ` AND status = $${paramIndex++}`;
      values.push(status);
    }
    if (search) {
      baseQuery += ` AND (correlation_id::text = $${paramIndex} OR entity_id = $${paramIndex} OR action ILIKE $${paramIndex + 1})`;
      values.push(search, `%${search}%`);
      paramIndex += 2;
    }

    const dataQuery = `SELECT * ${baseQuery} ORDER BY created_at DESC, id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const [result, totalResult] = await Promise.all([
      poolRead.query(dataQuery, [...values, limit, offset]),
      poolRead.query(countQuery, values),
    ]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      meta: {
        total: Number(totalResult.rows[0]?.count || 0),
        page,
        limit,
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      code: "AUDIT_LOG_FETCH_FAILED",
      message: "Failed to fetch logs",
    });
  }
};
