import { Router } from "express";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();
const PLAN_TYPES = new Set(["basic", "growth", "pro", "managed"]);
const CONFIG_LOCK_NAMESPACE = 41_708;

function correlationId(req: any) {
  return String(req?.correlationId || "-");
}

function adminId(req: any) {
  return Number(req.user?.id);
}

function shares(body: any): { artistShare: number; platformShare: number } | null {
  const artistShare = Number(body?.artistShare);
  const platformShare = Number(body?.platformShare);
  if (!Number.isFinite(artistShare) || !Number.isFinite(platformShare)) return null;
  if (artistShare < 0 || platformShare < 0 || artistShare > 100 || platformShare > 100) return null;
  if (Math.abs(artistShare + platformShare - 100) > 1e-9) return null;
  return { artistShare, platformShare };
}

async function configLock(client: any, key: number) {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [CONFIG_LOCK_NAMESPACE, key]);
}

function fail(res: any, req: any, error: unknown, operation: string) {
  const id = correlationId(req);
  logger.error({ error, operation, correlationId: id, adminId: adminId(req) }, "[AdminGovernance] Operation failed");
  return res.status(500).json({
    success: false,
    code: "ADMIN_GOVERNANCE_CONFIG_FAILED",
    message: "Configuration operation failed",
    correlationId: id,
  });
}

router.get("/revenue-share-config", async (req: any, res: any) => {
  const id = correlationId(req);
  try {
    const result = await pool.query(
      `SELECT id, version, artist_share, platform_share, effective_from, is_active, created_at
         FROM revenue_share_configs
        ORDER BY created_at DESC, id DESC`
    );
    const descriptions: Record<string, { name: string; description: string; benefits: string[] }> = {
      basic: { name: "Basic Plan", description: "Standard streaming with essential tools for new artists", benefits: ["Standard Streaming", "Artist Dashboard", "Basic Analytics"] },
      growth: { name: "Growth Plan", description: "Enhanced support and analytics for growing artists", benefits: ["Standard Streaming", "Promotional Support", "Advanced Analytics"] },
      pro: { name: "Pro Plan", description: "Professional promotion and featured placement", benefits: ["Promotion", "Featured Placement"] },
      managed: { name: "Managed Plan", description: "Full management support with priority promotion", benefits: ["Priority Promotion", "Artist Management Support"] },
    };
    return res.json({
      success: true,
      configs: result.rows.map((row: any) => ({
        id: row.id,
        version: row.version,
        name: descriptions[row.version]?.name || `Plan ${row.version}`,
        description: descriptions[row.version]?.description || "",
        benefits: descriptions[row.version]?.benefits || [],
        artistShare: Number(row.artist_share),
        platformShare: Number(row.platform_share),
        effectiveFrom: row.effective_from,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
      })),
      correlationId: id,
    });
  } catch (error) {
    return fail(res, req, error, "revenue-share.read");
  }
});

router.post("/revenue-share-config", async (req: any, res: any) => {
  const id = correlationId(req);
  const version = String(req.body?.version || "").trim().toLowerCase();
  const parsed = shares(req.body);
  if (!PLAN_TYPES.has(version) || !parsed) {
    return res.status(400).json({ success: false, code: "INVALID_REVENUE_SHARE_CONFIG", message: "Valid plan type and shares summing to 100 are required", correlationId: id });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await configLock(client, 1);
    const existing = await client.query("SELECT id FROM revenue_share_configs WHERE version = $1 LIMIT 1", [version]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: "REVENUE_SHARE_VERSION_EXISTS", message: `Plan type '${version}' already exists. Use PUT to update instead.`, correlationId: id });
    }
    const inserted = await client.query(
      `INSERT INTO revenue_share_configs (version, artist_share, platform_share, effective_from, is_active)
       VALUES ($1, $2, $3, now(), true)
       RETURNING id, version, artist_share, platform_share, is_active`,
      [version, parsed.artistShare, parsed.platformShare]
    );
    await AuditService.logCritical({
      action: "admin.revenue_share_config_created",
      entity: "revenue_share_config",
      entityId: String(inserted.rows[0].id),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: id,
      metadata: { version, artistShare: parsed.artistShare, platformShare: parsed.platformShare },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, version, artistShare: parsed.artistShare, platformShare: parsed.platformShare, correlationId: id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "revenue-share.create");
  } finally {
    client.release();
  }
});

router.patch("/revenue-share-config", async (req: any, res: any) => {
  const id = correlationId(req);
  const parsed = shares(req.body);
  if (!parsed) {
    return res.status(400).json({ success: false, code: "INVALID_REVENUE_SHARE_CONFIG", message: "Revenue shares must be valid numbers summing to 100", correlationId: id });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await configLock(client, 1);
    const versions = await client.query<{ version: string }>("SELECT version FROM revenue_share_configs ORDER BY created_at DESC, id DESC");
    let max = 0;
    for (const row of versions.rows) {
      const match = String(row.version || "").match(/^v(\d+)$/i);
      if (match) max = Math.max(max, Number(match[1]));
    }
    const version = `v${max + 1}`;
    const inserted = await client.query(
      `INSERT INTO revenue_share_configs (version, artist_share, platform_share, effective_from, is_active)
       VALUES ($1, $2, $3, now(), true)
       RETURNING id`,
      [version, parsed.artistShare, parsed.platformShare]
    );
    await client.query("UPDATE revenue_share_configs SET is_active = false, updated_at = now() WHERE id <> $1", [inserted.rows[0].id]);
    await AuditService.logCritical({
      action: "admin.revenue_share_config_published", entity: "revenue_share_config", entityId: String(inserted.rows[0].id),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: id,
      metadata: { version, artistShare: parsed.artistShare, platformShare: parsed.platformShare },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, version, artistShare: parsed.artistShare, platformShare: parsed.platformShare, correlationId: id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "revenue-share.publish");
  } finally {
    client.release();
  }
});

router.put("/revenue-share-config/:id", async (req: any, res: any) => {
  const correlation = correlationId(req);
  const configId = Number(req.params.id);
  if (!Number.isSafeInteger(configId) || configId <= 0) {
    return res.status(400).json({ success: false, code: "INVALID_REVENUE_SHARE_ID", message: "Invalid id", correlationId: correlation });
  }
  const hasShares = req.body?.artistShare !== undefined || req.body?.platformShare !== undefined;
  const parsed = hasShares ? shares(req.body) : null;
  if (hasShares && !parsed) {
    return res.status(400).json({ success: false, code: "INVALID_REVENUE_SHARE_CONFIG", message: "Both shares must be supplied and sum to 100", correlationId: correlation });
  }
  if (!hasShares && typeof req.body?.isActive !== "boolean") {
    return res.status(400).json({ success: false, code: "NO_REVENUE_SHARE_CHANGES", message: "No fields to update", correlationId: correlation });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM revenue_share_configs WHERE id = $1 FOR UPDATE", [configId]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "REVENUE_SHARE_CONFIG_NOT_FOUND", message: "Commission plan not found", correlationId: correlation });
    }
    const artistShare = parsed?.artistShare ?? Number(current.rows[0].artist_share);
    const platformShare = parsed?.platformShare ?? Number(current.rows[0].platform_share);
    const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : Boolean(current.rows[0].is_active);
    const updated = await client.query(
      `UPDATE revenue_share_configs
          SET artist_share = $2, platform_share = $3, is_active = $4, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [configId, artistShare, platformShare, isActive]
    );
    await AuditService.logCritical({
      action: "admin.revenue_share_config_updated", entity: "revenue_share_config", entityId: String(configId),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { previous: { artistShare: Number(current.rows[0].artist_share), platformShare: Number(current.rows[0].platform_share), isActive: Boolean(current.rows[0].is_active) }, next: { artistShare, platformShare, isActive } },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, config: updated.rows[0], correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "revenue-share.update");
  } finally {
    client.release();
  }
});

router.delete("/revenue-share-config/:id", async (req: any, res: any) => {
  const correlation = correlationId(req);
  const configId = Number(req.params.id);
  if (!Number.isSafeInteger(configId) || configId <= 0) {
    return res.status(400).json({ success: false, code: "INVALID_REVENUE_SHARE_ID", message: "Invalid id", correlationId: correlation });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM revenue_share_configs WHERE id = $1 FOR UPDATE", [configId]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "REVENUE_SHARE_CONFIG_NOT_FOUND", message: "Commission plan not found", correlationId: correlation });
    }
    await client.query("DELETE FROM revenue_share_configs WHERE id = $1", [configId]);
    await AuditService.logCritical({
      action: "admin.revenue_share_config_deleted", entity: "revenue_share_config", entityId: String(configId),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: correlation,
      metadata: { version: current.rows[0].version, artistShare: Number(current.rows[0].artist_share), platformShare: Number(current.rows[0].platform_share) },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Commission plan deleted", correlationId: correlation });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "revenue-share.delete");
  } finally {
    client.release();
  }
});

router.get("/terms-versions", async (req: any, res: any) => {
  const id = correlationId(req);
  try {
    const result = await pool.query(
      `SELECT version, content, effective_from, is_active, created_at, updated_at
         FROM terms_versions
        ORDER BY created_at DESC, id DESC`
    );
    return res.json({
      success: true,
      terms: result.rows.map((row: any) => ({ version: row.version, content: row.content, effectiveFrom: row.effective_from, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at })),
      correlationId: id,
    });
  } catch (error) {
    return fail(res, req, error, "terms.read");
  }
});

router.get("/terms-versions/active", async (req: any, res: any) => {
  const id = correlationId(req);
  try {
    const result = await pool.query(
      `SELECT version, content, effective_from, created_at
         FROM terms_versions
        WHERE is_active = true
        ORDER BY created_at DESC, id DESC
        LIMIT 1`
    );
    if (!result.rowCount) return res.status(404).json({ success: false, code: "ACTIVE_TERMS_NOT_FOUND", message: "No active terms found", correlationId: id });
    return res.json({ success: true, terms: result.rows[0], correlationId: id });
  } catch (error) {
    return fail(res, req, error, "terms.active");
  }
});

router.post("/terms-versions", async (req: any, res: any) => {
  const id = correlationId(req);
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 100_000) {
    return res.status(400).json({ success: false, code: "INVALID_TERMS_CONTENT", message: "Terms content is required and must not exceed 100000 characters", correlationId: id });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await configLock(client, 2);
    const versions = await client.query<{ version: string }>("SELECT version FROM terms_versions ORDER BY created_at DESC, id DESC");
    let max = 0;
    for (const row of versions.rows) {
      const match = String(row.version || "").match(/^v(\d+)$/i);
      if (match) max = Math.max(max, Number(match[1]));
    }
    const version = `v${max + 1}`;
    const inserted = await client.query(
      `INSERT INTO terms_versions (version, content, effective_from, is_active)
       VALUES ($1, $2, now(), true) RETURNING id`,
      [version, content]
    );
    await client.query("UPDATE terms_versions SET is_active = false, updated_at = now() WHERE id <> $1", [inserted.rows[0].id]);
    await AuditService.logCritical({
      action: "admin.terms_version_published", entity: "terms_version", entityId: String(inserted.rows[0].id),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: id,
      metadata: { version, contentLength: content.length },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, version, content, correlationId: id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "terms.publish");
  } finally {
    client.release();
  }
});

router.put("/terms-versions/:version", async (req: any, res: any) => {
  const id = correlationId(req);
  const version = String(req.params.version || "").trim();
  if (!version || typeof req.body?.isActive !== "boolean") {
    return res.status(400).json({ success: false, code: "INVALID_TERMS_STATUS", message: "version and boolean isActive are required", correlationId: id });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await configLock(client, 2);
    const current = await client.query("SELECT id, version, is_active FROM terms_versions WHERE version = $1 FOR UPDATE", [version]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "TERMS_VERSION_NOT_FOUND", message: "Terms version not found", correlationId: id });
    }
    const isActive = req.body.isActive as boolean;
    if (isActive) {
      await client.query("UPDATE terms_versions SET is_active = false, updated_at = now() WHERE version <> $1", [version]);
    }
    await client.query("UPDATE terms_versions SET is_active = $2, updated_at = now() WHERE version = $1", [version, isActive]);
    await AuditService.logCritical({
      action: "admin.terms_version_status_changed", entity: "terms_version", entityId: String(current.rows[0].id),
      performedBy: adminId(req), role: "admin", status: "success", correlationId: id,
      metadata: { version, previousIsActive: Boolean(current.rows[0].is_active), isActive },
    }, client);
    await client.query("COMMIT");
    return res.json({ success: true, version, isActive, correlationId: id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return fail(res, req, error, "terms.status");
  } finally {
    client.release();
  }
});

export default router;
