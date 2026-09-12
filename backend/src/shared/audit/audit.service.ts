import { pool } from "../../common/db/index";
import { v4 as uuidv4 } from "uuid";

interface AuditLogPayload {
  action: string;
  entity: string;
  entityId: string;
  performedBy?: number | string;
  role?: "fan" | "artist" | "admin" | "finance" | "moderator" | "system";
  status: "success" | "failed" | "pending";
  correlationId?: string;
  ipAddress?: string;
  metadata?: Record<string, any>;
}

export class AuditService {
  /**
   * Non-blocking governance/observability audit. Financial workflows must also
   * persist their durable state/audit markers inside their own DB transaction;
   * this asynchronous log is not used as the financial source of truth.
   */
  static log(payload: AuditLogPayload): void {
    setImmediate(async () => {
      try {
        const id = uuidv4();
        const query = `
          INSERT INTO audit_logs (id, action, entity, entity_id, actor_id, actor_role, status, correlation_id, ip_address, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
        const values = [
          id,
          payload.action,
          payload.entity,
          payload.entityId,
          payload.performedBy || null,
          payload.role || "system",
          payload.status,
          payload.correlationId || null,
          payload.ipAddress || null,
          payload.metadata ? JSON.stringify(payload.metadata) : null,
        ];

        await pool.query(query, values);
      } catch (error) {
        console.error("[AuditService] Failed to insert audit log:", error);
      }
    });
  }
}
