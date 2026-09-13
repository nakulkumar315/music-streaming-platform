import type { PoolClient } from "pg";
import { pool } from "../../common/db";

export type GovernanceRole = "ADMIN" | "MODERATOR";

export class ContentGovernanceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ContentGovernanceError";
  }
}

export type GovernanceActor = {
  userId: number;
  role: GovernanceRole;
  correlationId?: string;
};

type ContentRow = {
  id: number;
  title: string;
  type: string;
  artist_id: number;
  genre: string | null;
  lifecycle_state: string;
  is_approved: boolean;
  is_taken_down: boolean;
  rejection_reason: string | null;
  status: string;
  thumbnail_url: string | null;
  thumbnail_provider_asset_id: string | null;
  created_at: Date;
  published_at: Date | null;
};

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ContentGovernanceError(400, `INVALID_${field.toUpperCase()}`, `${field} is invalid`);
  }
  return parsed;
}

function validateActor(actor: GovernanceActor): GovernanceActor {
  positiveInteger(actor.userId, "actor_id");
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    throw new ContentGovernanceError(403, "CONTENT_GOVERNANCE_FORBIDDEN", "Content moderation permission is required");
  }
  return actor;
}

function correlationUuid(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

async function writeAudit(
  client: PoolClient,
  actor: GovernanceActor,
  contentId: number,
  action: string,
  metadata: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO audit_logs (
       id, action, entity, entity_id, actor_id, actor_role, status,
       correlation_id, metadata, created_at
     ) VALUES (
       gen_random_uuid(), $1, 'content', $2, $3, $4, 'success', $5, $6, now()
     )`,
    [
      action,
      String(contentId),
      actor.userId,
      actor.role,
      correlationUuid(actor.correlationId),
      metadata,
    ]
  );
}

async function lockContent(client: PoolClient, contentId: number): Promise<ContentRow> {
  const result = await client.query<ContentRow>(
    `SELECT id, title, type, artist_id, genre, lifecycle_state, is_approved,
            is_taken_down, rejection_reason, status, thumbnail_url,
            thumbnail_provider_asset_id, created_at, published_at
       FROM content_items
      WHERE id = $1
      LIMIT 1
      FOR UPDATE`,
    [contentId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ContentGovernanceError(404, "CONTENT_NOT_FOUND", "Content not found");
  }
  return row;
}

export async function listPendingContent(rawLimit = 50, rawOffset = 0) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(rawLimit) || 50)));
  const offset = Math.max(0, Math.floor(Number(rawOffset) || 0));

  const result = await pool.query(
    `SELECT c.id, c.title, c.type, c.genre, c.artist_id,
            c.lifecycle_state, c.is_approved, c.is_taken_down,
            c.rejection_reason, c.status AS technical_status,
            c.thumbnail_url, c.thumbnail_provider_asset_id,
            c.created_at, c.uploaded_at,
            COALESCE(NULLIF(a.name, ''), split_part(a.email, '@', 1)) AS artist_name
       FROM content_items c
       JOIN users a ON a.id = c.artist_id
      WHERE c.lifecycle_state = 'DRAFT'
        AND c.is_taken_down = FALSE
      ORDER BY c.created_at ASC
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
    isApproved: Boolean(row.is_approved),
    isTakenDown: Boolean(row.is_taken_down),
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
  }));
}

export async function approveContent(rawContentId: unknown, rawActor: GovernanceActor) {
  const contentId = positiveInteger(rawContentId, "content_id");
  const actor = validateActor(rawActor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const current = await lockContent(client, contentId);

    if (current.is_taken_down) {
      throw new ContentGovernanceError(409, "CONTENT_TAKEN_DOWN", "Taken-down content cannot be approved");
    }
    if (current.lifecycle_state === "EARLY_ACCESS" && current.is_approved) {
      await client.query("COMMIT");
      return { contentId, lifecycleState: "EARLY_ACCESS", technicalStatus: current.status, idempotent: true };
    }
    if (current.lifecycle_state !== "DRAFT") {
      throw new ContentGovernanceError(409, "ILLEGAL_CONTENT_TRANSITION", `Cannot approve content from ${current.lifecycle_state}`);
    }
    if (current.status !== "READY") {
      throw new ContentGovernanceError(409, "MEDIA_NOT_READY", `Content media is ${current.status}; approval requires READY`);
    }

    const updated = await client.query(
      `UPDATE content_items
          SET lifecycle_state = 'EARLY_ACCESS',
              is_approved = TRUE,
              rejection_reason = NULL,
              published_at = COALESCE(published_at, now())
        WHERE id = $1
        RETURNING lifecycle_state, status`,
      [contentId]
    );

    await writeAudit(client, actor, contentId, "content.approved", {
      from_lifecycle_state: current.lifecycle_state,
      to_lifecycle_state: "EARLY_ACCESS",
      technical_status: current.status,
    });
    await client.query("COMMIT");

    return {
      contentId,
      lifecycleState: String(updated.rows[0].lifecycle_state),
      technicalStatus: String(updated.rows[0].status),
      idempotent: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectContent(
  rawContentId: unknown,
  rawReason: unknown,
  rawActor: GovernanceActor
) {
  const contentId = positiveInteger(rawContentId, "content_id");
  const actor = validateActor(rawActor);
  const reason = String(rawReason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new ContentGovernanceError(400, "INVALID_REJECTION_REASON", "Rejection reason must be 3-500 characters");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await lockContent(client, contentId);

    if (current.is_taken_down) {
      throw new ContentGovernanceError(409, "CONTENT_TAKEN_DOWN", "Taken-down content cannot be rejected");
    }
    if (current.lifecycle_state !== "DRAFT" || current.is_approved) {
      throw new ContentGovernanceError(409, "ILLEGAL_CONTENT_TRANSITION", "Only unapproved DRAFT content can be rejected");
    }

    await client.query(
      `UPDATE content_items
          SET is_approved = FALSE,
              rejection_reason = $2,
              published_at = NULL
        WHERE id = $1`,
      [contentId, reason]
    );
    await writeAudit(client, actor, contentId, "content.rejected", {
      lifecycle_state: "DRAFT",
      technical_status: current.status,
      reason,
    });
    await client.query("COMMIT");
    return { contentId, lifecycleState: "DRAFT", rejectionReason: reason };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function takedownContent(
  rawContentId: unknown,
  rawReason: unknown,
  rawActor: GovernanceActor
) {
  const contentId = positiveInteger(rawContentId, "content_id");
  const actor = validateActor(rawActor);
  const reason = String(rawReason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new ContentGovernanceError(400, "INVALID_TAKEDOWN_REASON", "Takedown reason must be 3-500 characters");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await lockContent(client, contentId);
    if (current.is_taken_down) {
      await client.query("COMMIT");
      return { contentId, isTakenDown: true, idempotent: true };
    }

    await client.query(
      `UPDATE content_items
          SET is_taken_down = TRUE
        WHERE id = $1`,
      [contentId]
    );
    await writeAudit(client, actor, contentId, "content.takedown", {
      lifecycle_state: current.lifecycle_state,
      technical_status: current.status,
      reason,
    });
    await client.query("COMMIT");
    return { contentId, isTakenDown: true, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
