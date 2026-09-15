import { Router } from "express";
import { requireAuth } from "../common/auth/requireAuth";
import { pool } from "../common/db";
import { invalidateArtistCache } from "../common/cache";
import { AnalyticsController } from "../controllers/analyticsController";
import { AuditService } from "../shared/audit/audit.service";

const router = Router();
const EARLY_ACCESS_DAYS = 7;

function correlationId(req: any): string {
  return String(req?.correlationId || "-");
}

function requireArtist(req: any, res: any, next: any) {
  if (String(req.user?.role || "").toUpperCase() !== "ARTIST") {
    return res.status(403).json({
      success: false,
      code: "ARTIST_ROLE_REQUIRED",
      message: "Forbidden",
      correlationId: correlationId(req),
    });
  }
  return next();
}

function normalizePortfolioLinks(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("\n")
      : [];

  return raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeSocialLinks(value: unknown): Record<string, string> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("socialLinks must be an object"), { status: 400, code: "INVALID_SOCIAL_LINKS" });
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 10) {
    throw Object.assign(new Error("socialLinks supports at most 10 entries"), { status: 400, code: "INVALID_SOCIAL_LINKS" });
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    const candidate = String(rawValue ?? "").trim();
    if (!key || key.length > 32 || !candidate) continue;
    if (candidate.length > 500) {
      throw Object.assign(new Error("Social link is too long"), { status: 400, code: "INVALID_SOCIAL_LINK" });
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw Object.assign(new Error("Social links must be valid HTTP(S) URLs"), { status: 400, code: "INVALID_SOCIAL_LINK" });
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw Object.assign(new Error("Social links must use HTTP(S) without embedded credentials"), { status: 400, code: "INVALID_SOCIAL_LINK" });
    }
    normalized[key] = parsed.toString();
  }
  return normalized;
}

function sendRouteError(res: any, req: any, error: any, fallbackMessage: string) {
  const status = Number(error?.status || 500);
  return res.status(status >= 400 && status <= 599 ? status : 500).json({
    success: false,
    code: String(error?.code || "ARTIST_REQUEST_FAILED"),
    message: status >= 500 ? fallbackMessage : String(error?.message || fallbackMessage),
    correlationId: correlationId(req),
  });
}

// This one analytics endpoint is intentionally retained for backwards compatibility.
// The Phase 08 strict analytics router owns the rest of /dashboard and /analytics.
router.get(
  "/dashboard/subscription-insights",
  requireAuth,
  requireArtist,
  AnalyticsController.getArtistSubscriptionInsights
);

// Public onboarding dependencies. Query failures are never converted to empty data.
router.get("/commission-plans", async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT id, version, artist_share, platform_share, effective_from, is_active
         FROM revenue_share_configs
        WHERE is_active = TRUE
        ORDER BY effective_from DESC, id DESC`
    );

    const plans = result.rows.map((row: any) => ({
      id: row.id,
      version: row.version,
      name: `Plan ${row.version}`,
      description: "",
      benefits: [],
      artistShare: row.artist_share,
      platformShare: row.platform_share,
      effectiveFrom: row.effective_from,
      isActive: Boolean(row.is_active),
    }));

    return res.json({ success: true, plans, correlationId: correlationId(req) });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to fetch commission plans");
  }
});

router.get("/terms/current", async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT version, content, effective_from, is_active
         FROM terms_versions
        WHERE is_active = TRUE
        ORDER BY created_at DESC
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
        version: row.version,
        content: row.content,
        effectiveFrom: row.effective_from,
        isActive: Boolean(row.is_active),
      },
      correlationId: correlationId(req),
    });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to fetch terms");
  }
});

// Resubmission remains separate from the canonical POST /artist/onboard flow.
router.patch("/onboard", requireAuth, requireArtist, async (req: any, res: any) => {
  const artistId = Number(req.user?.id);
  const name = String(req.body?.artistName || "").trim();
  const bio = String(req.body?.bio || "").trim();
  const links = normalizePortfolioLinks(req.body?.portfolioLinks);
  const phone = req.body?.phone === undefined ? null : String(req.body.phone || "").trim();

  if (!name || name.length > 160 || !bio || bio.length > 4000 || !links.length) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ONBOARDING_RESUBMISSION",
      message: "artistName, bio and portfolioLinks are required and must be within supported limits",
      correlationId: correlationId(req),
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
          SET name = $2,
              phone = COALESCE(NULLIF($3, ''), phone),
              artist_bio = $4,
              portfolio_links = $5,
              artist_status = 'PENDING',
              onboarded_at = now(),
              updated_at = now()
        WHERE id = $1
          AND UPPER(role) = 'ARTIST'
          AND COALESCE(is_deleted, FALSE) = FALSE
          AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
          AND UPPER(COALESCE(artist_status::text, 'PENDING')) <> 'APPROVED'
        RETURNING id`,
      [artistId, name, phone, bio, links]
    );
    if (!result.rows.length) {
      return res.status(409).json({
        success: false,
        code: "ARTIST_RESUBMISSION_NOT_ALLOWED",
        message: "Artist onboarding cannot be resubmitted in the current account state",
        correlationId: correlationId(req),
      });
    }

    AuditService.log({
      action: "artist.onboarding_resubmitted",
      entity: "user",
      entityId: String(artistId),
      performedBy: artistId,
      role: "artist",
      status: "success",
      correlationId: correlationId(req),
    });
    return res.json({ success: true, correlationId: correlationId(req) });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to resubmit application");
  }
});

router.patch("/appeal", requireAuth, requireArtist, async (req: any, res: any) => {
  const artistId = Number(req.user?.id);
  const message = String(req.body?.message || "").trim();
  if (message.length < 3 || message.length > 2000) {
    return res.status(400).json({
      success: false,
      code: "INVALID_APPEAL",
      message: "Appeal message must be 3-2000 characters",
      correlationId: correlationId(req),
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
          SET artist_appeal_message = $2, updated_at = now()
        WHERE id = $1
          AND UPPER(role) = 'ARTIST'
          AND COALESCE(is_deleted, FALSE) = FALSE
        RETURNING id`,
      [artistId, message]
    );
    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        code: "ARTIST_NOT_FOUND",
        message: "Artist not found",
        correlationId: correlationId(req),
      });
    }
    AuditService.log({
      action: "artist.appeal_submitted",
      entity: "user",
      entityId: String(artistId),
      performedBy: artistId,
      role: "artist",
      status: "success",
      correlationId: correlationId(req),
    });
    return res.json({ success: true, correlationId: correlationId(req) });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to submit appeal");
  }
});

router.get("/me", requireAuth, requireArtist, async (req: any, res: any) => {
  const artistId = Number(req.user?.id);
  try {
    const result = await pool.query(
      `SELECT id, email, name,
              COALESCE(is_verified, verified, false) AS is_verified,
              COALESCE(status, 'ACTIVE') AS status,
              COALESCE(artist_status, 'PENDING') AS artist_status,
              profile_image_url, banner_image_url, bio, artist_bio,
              portfolio_links, onboarded_at, artist_appeal_message,
              accent_color, social_links,
              COALESCE(subscription_features, '[]'::jsonb) AS subscription_features,
              subscription_price, yearly_subscription_price, admin_remarks
         FROM users
        WHERE id = $1
          AND UPPER(role) = 'ARTIST'
          AND COALESCE(is_deleted, FALSE) = FALSE
        LIMIT 1`,
      [artistId]
    );
    const row: any = result.rows[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        code: "ARTIST_NOT_FOUND",
        message: "Artist not found",
        correlationId: correlationId(req),
      });
    }

    return res.json({
      success: true,
      artist: {
        id: row.id,
        email: row.email,
        name: row.name ?? null,
        isVerified: Boolean(row.is_verified),
        status: String(row.status ?? "ACTIVE"),
        artistStatus: String(row.artist_status ?? "PENDING"),
        profileImageUrl: row.profile_image_url ?? null,
        bannerImageUrl: row.banner_image_url ?? null,
        bio: row.bio ?? "",
        artistBio: row.artist_bio ?? null,
        portfolioLinks: Array.isArray(row.portfolio_links) ? row.portfolio_links : [],
        onboardedAt: row.onboarded_at ?? null,
        appealMessage: row.artist_appeal_message ?? null,
        adminNote: row.admin_remarks ?? null,
        accentColor: row.accent_color ?? null,
        socialLinks: row.social_links ?? null,
        subscriptionPrice: Number(row.subscription_price ?? 0),
        yearlySubscriptionPrice: Number(row.yearly_subscription_price ?? 0),
        subscriptionFeatures: Array.isArray(row.subscription_features) ? row.subscription_features : [],
      },
      earlyAccessDays: EARLY_ACCESS_DAYS,
      correlationId: correlationId(req),
    });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to fetch profile");
  }
});

router.patch("/me", requireAuth, requireArtist, async (req: any, res: any) => {
  const artistId = Number(req.user?.id);
  const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, "name");
  const hasBio = Object.prototype.hasOwnProperty.call(req.body || {}, "bio");
  const hasAccent = Object.prototype.hasOwnProperty.call(req.body || {}, "accentColor");
  const hasSocial = Object.prototype.hasOwnProperty.call(req.body || {}, "socialLinks");

  const name = hasName ? String(req.body?.name ?? "").trim() : null;
  const bio = hasBio ? String(req.body?.bio ?? "").trim() : null;
  const accent = hasAccent ? String(req.body?.accentColor ?? "").trim() : null;

  if (hasName && (!name || name.length > 160)) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_NAME", message: "Artist name is invalid", correlationId: correlationId(req) });
  }
  if (hasBio && bio !== null && bio.length > 4000) {
    return res.status(400).json({ success: false, code: "INVALID_ARTIST_BIO", message: "Artist bio is too long", correlationId: correlationId(req) });
  }
  if (hasAccent && accent && !/^#[0-9a-f]{6}$/i.test(accent)) {
    return res.status(400).json({ success: false, code: "INVALID_ACCENT_COLOR", message: "accentColor must be a six-digit hex color", correlationId: correlationId(req) });
  }

  let socialLinks: Record<string, string> | null | undefined;
  try {
    socialLinks = hasSocial ? normalizeSocialLinks(req.body?.socialLinks) : undefined;
  } catch (error) {
    return sendRouteError(res, req, error, "Invalid social links");
  }

  try {
    const result = await pool.query(
      `UPDATE users
          SET name = CASE WHEN $2 THEN $3 ELSE name END,
              bio = CASE WHEN $4 THEN $5 ELSE bio END,
              accent_color = CASE WHEN $6 THEN NULLIF($7, '') ELSE accent_color END,
              social_links = CASE WHEN $8 THEN $9::jsonb ELSE social_links END,
              updated_at = now()
        WHERE id = $1
          AND UPPER(role) = 'ARTIST'
          AND COALESCE(is_deleted, FALSE) = FALSE
        RETURNING id`,
      [
        artistId,
        hasName,
        name,
        hasBio,
        bio,
        hasAccent,
        accent,
        hasSocial,
        socialLinks === undefined ? null : JSON.stringify(socialLinks),
      ]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlationId(req) });
    }

    // Profile/banner media are deliberately not writable here. The validated
    // artist asset upload route owns provider-backed public asset changes.
    AuditService.log({
      action: "artist.profile_updated",
      entity: "user",
      entityId: String(artistId),
      performedBy: artistId,
      role: "artist",
      status: "success",
      correlationId: correlationId(req),
      metadata: { fields: [hasName && "name", hasBio && "bio", hasAccent && "accentColor", hasSocial && "socialLinks"].filter(Boolean) },
    });
    await invalidateArtistCache();
    return res.json({ success: true, correlationId: correlationId(req) });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to update profile");
  }
});

router.get("/channel-preview", requireAuth, requireArtist, async (req: any, res: any) => {
  const artistId = Number(req.user?.id);
  try {
    const [artistResult, contentResult] = await Promise.all([
      pool.query(
        `SELECT id, email, name, profile_image_url, banner_image_url, COALESCE(bio, '') AS bio
           FROM users
          WHERE id = $1
            AND UPPER(role) = 'ARTIST'
            AND COALESCE(is_deleted, FALSE) = FALSE
          LIMIT 1`,
        [artistId]
      ),
      pool.query(
        `SELECT id, title, type, thumbnail_url, created_at, published_at,
                COALESCE(subscription_required, false) AS subscription_required,
                lifecycle_state
           FROM content_items
          WHERE artist_id = $1
            AND COALESCE(is_approved, false) = TRUE
            AND COALESCE(is_taken_down, false) = FALSE
          ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
          LIMIT 200`,
        [artistId]
      ),
    ]);

    const artist: any = artistResult.rows[0];
    if (!artist) {
      return res.status(404).json({ success: false, code: "ARTIST_NOT_FOUND", message: "Artist not found", correlationId: correlationId(req) });
    }

    const now = Date.now();
    const items = contentResult.rows.map((row: any) => {
      const publishedAt = row.published_at ? new Date(row.published_at) : null;
      return {
        id: row.id,
        title: row.title,
        type: String(row.type ?? ""),
        thumbnailUrl: row.thumbnail_url ?? null,
        subscriptionRequired: Boolean(row.subscription_required),
        publishedAt: row.published_at ?? null,
        isEarlyAccess: Boolean(row.subscription_required && publishedAt && publishedAt.getTime() > now),
        lifecycleState: String(row.lifecycle_state ?? "DRAFT"),
      };
    });

    return res.json({
      success: true,
      artist: {
        id: artist.id,
        name: artist.name ?? null,
        email: artist.email,
        profileImageUrl: artist.profile_image_url ?? null,
        bannerImageUrl: artist.banner_image_url ?? null,
        bio: artist.bio ?? "",
      },
      items,
      correlationId: correlationId(req),
    });
  } catch (error) {
    return sendRouteError(res, req, error, "Failed to fetch channel preview");
  }
});

export default router;
