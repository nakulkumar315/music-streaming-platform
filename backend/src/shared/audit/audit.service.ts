import type { PoolClient } from "pg";
import { pool } from "../../common/db/index";
import { logger } from "../../common/logger";
import { v4 as uuidv4 } from "uuid";

export interface AuditLogPayload {
  action: string;
  entity: string;
  entityId: string;
  performedBy?: number | string;
  role?: "fan" | "artist" | "admin" | "finance" | "moderator" | "system";
  status: "success" | "failed" | "pending";
  correlationId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

type AuditQueryClient = Pick<PoolClient, "query">;

const SENSITIVE_KEY = /(?:authorization|password|passwd|token|secret|signature|signed.?url|playback.?url|media.?url|razorpay.?key|razorpay.?secret|card|cvv)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeValue(nested, depth + 1);
    }
    return output;
  }
  return String(value);
}

function sanitizedMetadata(metadata: AuditLogPayload["metadata"]): Record<string, unknown> | null {
  if (!metadata) return null;
  return sanitizeValue(metadata) as Record<string, unknown>;
}

function normalizedCorrelationId(value: string | undefined): string | null {
  const raw = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

async function persistAudit(payload: AuditLogPayload, client: AuditQueryClient): Promise<void> {
  const id = uuidv4();
  await client.query(
    `INSERT INTO audit_logs
       (id, action, entity, entity_id, actor_id, actor_role, status,
        correlation_id, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      String(payload.action).slice(0, 100),
      String(payload.entity).slice(0, 100),
      String(payload.entityId).slice(0, 255),
      payload.performedBy ?? null,
      payload.role || "system",
      payload.status,
      normalizedCorrelationId(payload.correlationId),
      payload.ipAddress ? String(payload.ipAddress).slice(0, 45) : null,
      sanitizedMetadata(payload.metadata),
    ]
  );
}

export class AuditService {
  /**
   * Best-effort observability audit for noncritical events only.
   * Critical privileged/business mutations must use logCritical(), preferably
   * with the same transaction client as the state change.
   */
  static log(payload: AuditLogPayload): void {
    setImmediate(() => {
      void persistAudit(payload, pool).catch((error) => {
        logger.error(
          {
            error,
            action: payload.action,
            entity: payload.entity,
            entityId: payload.entityId,
            correlationId: payload.correlationId,
          },
          "[AuditService] Best-effort audit persistence failed"
        );
      });
    });
  }

  /**
   * Durable audit boundary. Failure is propagated to the caller so a critical
   * action cannot report success while silently losing its audit record.
   * Pass the caller's transaction client to make business state + audit atomic.
   */
  static async logCritical(
    payload: AuditLogPayload,
    client: AuditQueryClient = pool
  ): Promise<void> {
    await persistAudit(payload, client);
  }
}
