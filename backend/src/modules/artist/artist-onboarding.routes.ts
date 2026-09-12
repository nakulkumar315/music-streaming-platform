import bcrypt from "bcrypt";
import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import path from "path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { optionalAuth } from "../../common/auth/requireAuth";
import { normalizeDeviceId, SessionService } from "../../common/auth/session.service";
import { pool } from "../../common/db";
import { logger } from "../../common/logger";
import { uploadLimiter } from "../../common/security/rateLimit";
import { AgreementPdfService } from "../../services/agreement-pdf.service";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();

function encryptSignature(signature: string) {
  const rawKey = String(process.env.SIGNATURE_ENCRYPTION_KEY || "").trim();
  if (!rawKey) {
    const error: any = new Error("Signature encryption is not configured");
    error.status = 500;
    error.code = "SIGNATURE_ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }

  const key = /^[a-f0-9]{64}$/i.test(rawKey)
    ? Buffer.from(rawKey, "hex")
    : crypto.createHash("sha256").update(rawKey, "utf8").digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(signature, "utf8")),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function parsePortfolioLinks(value: unknown) {
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

function requestDeviceId(req: any) {
  const bodyValue = req.body?.deviceId;
  const headerValue = req.headers?.["x-device-id"];
  const candidate = bodyValue ?? (Array.isArray(headerValue) ? headerValue[0] : headerValue);
  return normalizeDeviceId(String(candidate || ""));
}

async function createAgreementPdf(input: {
  userId: number;
  artistName: string;
  email: string;
  phone?: string;
  agreementVersion: string;
  agreementId: string;
  acceptedAt: Date;
  signatureSignedAt: Date;
  digitalSignature: string;
  termsVersion: string;
  termsContent: string;
  artistRevenueShare?: number;
  platformRevenueShare?: number;
}) {
  try {
    const pdfBuffer = await AgreementPdfService.generateAgreementPdf({
      artistName: input.artistName,
      email: input.email,
      phone: input.phone,
      agreementVersion: input.agreementVersion,
      artistRevenueShare: input.artistRevenueShare ?? 55,
      platformRevenueShare: input.platformRevenueShare ?? 45,
      agreementAcceptedAt: input.acceptedAt,
      signatureSignedAt: input.signatureSignedAt,
      agreementId: input.agreementId,
      digitalSignature: input.digitalSignature,
      termsVersion: input.termsVersion,
      termsContent: input.termsContent,
      agreementStartDate: input.acceptedAt,
    });

    const pdfDir = path.join(process.cwd(), "public", "agreements");
    await fs.promises.mkdir(pdfDir, { recursive: true });
    const pdfFileName = `agreement-${input.agreementId}.pdf`;
    await fs.promises.writeFile(path.join(pdfDir, pdfFileName), pdfBuffer);
    const agreementPdfPath = `/agreements/${pdfFileName}`;

    await pool.query(
      "UPDATE users SET agreement_pdf_path = $2, updated_at = now() WHERE id = $1",
      [input.userId, agreementPdfPath]
    );
    return agreementPdfPath;
  } catch (error) {
    logger.error(
      { error, userId: input.userId, agreementId: input.agreementId },
      "[artist/onboarding] Agreement PDF generation failed"
    );
    return null;
  }
}

router.post("/", uploadLimiter, optionalAuth, async (req: any, res) => {
  const correlationId = req?.correlationId || "-";
  const {
    email,
    password,
    artistName,
    bio,
    portfolioLinks,
    phone,
    genre,
    agreementAccepted,
    agreementVersion,
    commissionPlanIds,
    digitalSignature,
    termsVersion,
  } = req.body ?? {};

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(artistName || "").trim();
  const normalizedBio = String(bio || "").trim();
  const links = parsePortfolioLinks(portfolioLinks);

  if (!normalizedEmail || !normalizedName) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Email and artist name are required",
      correlationId,
    });
  }

  let deviceId: string;
  try {
    deviceId = requestDeviceId(req);
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      code: error?.code || "DEVICE_ID_REQUIRED",
      message: "Unable to identify this device",
      correlationId,
    });
  }

  const wantsAgreement = agreementAccepted === true;
  if (wantsAgreement && (!digitalSignature || !termsVersion || !agreementVersion)) {
    return res.status(400).json({
      success: false,
      code: "AGREEMENT_DATA_REQUIRED",
      message: "Agreement version, terms version and signature are required",
      correlationId,
    });
  }

  let selectedPlans: any[] = [];
  let termsContent = "";

  try {
    if (Array.isArray(commissionPlanIds) && commissionPlanIds.length > 0) {
      const plans = await pool.query(
        `SELECT id, artist_share, platform_share, version
           FROM revenue_share_configs
          WHERE id = ANY($1::int[]) AND is_active = true
          ORDER BY id`,
        [commissionPlanIds.map((id: unknown) => Number(id))]
      );
      if (plans.rows.length !== commissionPlanIds.length) {
        return res.status(400).json({
          success: false,
          code: "INVALID_COMMISSION_PLAN",
          message: "One or more selected commission plans are unavailable",
          correlationId,
        });
      }
      selectedPlans = plans.rows;
    }

    if (wantsAgreement) {
      const terms = await pool.query(
        `SELECT version, content
           FROM terms_versions
          WHERE version = $1 AND is_active = true
          LIMIT 1`,
        [String(termsVersion)]
      );
      if (!terms.rows.length) {
        return res.status(400).json({
          success: false,
          code: "INVALID_TERMS_VERSION",
          message: "Selected terms are unavailable",
          correlationId,
        });
      }
      termsContent = String(terms.rows[0].content || "");
    }

    const existingResult = await pool.query(
      `SELECT id, email, role, status, is_deleted, artist_status, agreement_accepted
         FROM users
        WHERE LOWER(email) = $1
        LIMIT 1`,
      [normalizedEmail]
    );
    const existing = existingResult.rows?.[0] ?? null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let userId: number;
      let sessionId: number | null = null;
      let created = false;
      const acceptedAt = wantsAgreement ? new Date() : null;
      const agreementId = wantsAgreement ? uuidv4() : null;
      const encryptedSignature = wantsAgreement
        ? encryptSignature(String(digitalSignature))
        : null;

      if (!existing) {
        const rawPassword = String(password || "");
        if (rawPassword.length < 6 || rawPassword.length > 128) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            code: "INVALID_PASSWORD",
            message: "Password must be between 6 and 128 characters",
            correlationId,
          });
        }

        const passwordHash = await bcrypt.hash(rawPassword, 10);
        const inserted = await client.query(
          `INSERT INTO users (
             email, password, name, role, status, is_deleted,
             is_verified, verified, phone, genre, artist_status,
             artist_bio, portfolio_links, onboarded_at, created_at, updated_at,
             agreement_accepted, agreement_accepted_at, agreement_version,
             digital_signature, signature_signed_at, agreement_id, terms_version,
             agreement_status, agreement_start_date, signature_ip_address,
             signature_user_agent, artist_revenue_share, platform_revenue_share
           )
           VALUES (
             $1, $2, $3, 'ARTIST', 'ACTIVE', false,
             false, false, $4, $5, 'PENDING',
             $6, $7, now(), now(), now(),
             $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20
           )
           RETURNING id`,
          [
            normalizedEmail,
            passwordHash,
            normalizedName,
            phone ? String(phone).trim() : null,
            genre ? String(genre).trim() : null,
            normalizedBio,
            links,
            wantsAgreement,
            acceptedAt,
            wantsAgreement ? String(agreementVersion) : null,
            encryptedSignature,
            acceptedAt,
            agreementId,
            wantsAgreement ? String(termsVersion) : null,
            wantsAgreement ? "PENDING_APPROVAL" : null,
            acceptedAt,
            req.ip || null,
            String(req.headers["user-agent"] || ""),
            selectedPlans[0]?.artist_share ?? null,
            selectedPlans[0]?.platform_share ?? null,
          ]
        );
        userId = Number(inserted.rows[0].id);
        const session = await SessionService.createSessionInTransaction(client, {
          userId,
          deviceId,
          deviceName: String(req.headers["user-agent"] || "Artist browser"),
        });
        sessionId = session.id;
        created = true;
      } else {
        const existingId = Number(existing.id);
        const authenticatedId = Number(req.user?.id);

        if (!authenticatedId || authenticatedId !== existingId) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            code: "ACCOUNT_EXISTS",
            message: "An account already exists for this email. Sign in to continue.",
            correlationId,
          });
        }

        const role = String(existing.role || "").toUpperCase();
        if (role !== "ARTIST" && role !== "FAN") {
          await client.query("ROLLBACK");
          return res.status(403).json({
            success: false,
            code: "ROLE_NOT_ELIGIBLE",
            message: "This account cannot start artist onboarding",
            correlationId,
          });
        }
        if (existing.is_deleted === true || String(existing.status || "").toUpperCase() !== "ACTIVE") {
          await client.query("ROLLBACK");
          return res.status(403).json({
            success: false,
            code: "ACCOUNT_INACTIVE",
            message: "Account is not available",
            correlationId,
          });
        }
        if (existing.agreement_accepted === true) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            code: "ONBOARDING_ALREADY_COMPLETED",
            message: "Artist onboarding has already been completed",
            correlationId,
          });
        }
        if (role === "ARTIST" && String(existing.artist_status || "").toUpperCase() === "APPROVED") {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            code: "ARTIST_ALREADY_APPROVED",
            message: "Approved artist accounts cannot restart onboarding",
            correlationId,
          });
        }

        // Ownership has been proven by the active server-backed session. Never
        // rewrite the password from a public onboarding payload.
        const updated = await client.query(
          `UPDATE users
              SET name = $2,
                  role = 'ARTIST',
                  is_verified = false,
                  verified = false,
                  phone = COALESCE($3, phone),
                  genre = COALESCE($4, genre),
                  artist_status = 'PENDING',
                  artist_bio = $5,
                  portfolio_links = $6,
                  onboarded_at = now(),
                  updated_at = now(),
                  agreement_accepted = CASE WHEN $7 THEN true ELSE agreement_accepted END,
                  agreement_accepted_at = CASE WHEN $7 THEN $8 ELSE agreement_accepted_at END,
                  agreement_version = CASE WHEN $7 THEN $9 ELSE agreement_version END,
                  digital_signature = CASE WHEN $7 THEN $10 ELSE digital_signature END,
                  signature_signed_at = CASE WHEN $7 THEN $8 ELSE signature_signed_at END,
                  agreement_id = CASE WHEN $7 THEN $11 ELSE agreement_id END,
                  terms_version = CASE WHEN $7 THEN $12 ELSE terms_version END,
                  agreement_status = CASE WHEN $7 THEN 'PENDING_APPROVAL' ELSE agreement_status END,
                  agreement_start_date = CASE WHEN $7 THEN $8 ELSE agreement_start_date END,
                  signature_ip_address = CASE WHEN $7 THEN $13 ELSE signature_ip_address END,
                  signature_user_agent = CASE WHEN $7 THEN $14 ELSE signature_user_agent END,
                  artist_revenue_share = COALESCE($15, artist_revenue_share),
                  platform_revenue_share = COALESCE($16, platform_revenue_share)
            WHERE id = $1 AND is_deleted = false AND status = 'ACTIVE'
            RETURNING id`,
          [
            existingId,
            normalizedName,
            phone ? String(phone).trim() : null,
            genre ? String(genre).trim() : null,
            normalizedBio,
            links,
            wantsAgreement,
            acceptedAt,
            wantsAgreement ? String(agreementVersion) : null,
            encryptedSignature,
            agreementId,
            wantsAgreement ? String(termsVersion) : null,
            req.ip || null,
            String(req.headers["user-agent"] || ""),
            selectedPlans[0]?.artist_share ?? null,
            selectedPlans[0]?.platform_share ?? null,
          ]
        );
        if (!updated.rows.length) {
          throw new Error("Artist onboarding update failed");
        }
        userId = existingId;
        sessionId = Number(req.user.sessionId);
      }

      await client.query("COMMIT");

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new Error("JWT_SECRET is not configured");
      }

      let token: string | undefined;
      if (created) {
        token = jwt.sign(
          { id: userId, email: normalizedEmail, role: "ARTIST", sid: sessionId },
          secret,
          { expiresIn: "1d" }
        );
      }

      let agreementPdfPath: string | null = null;
      if (wantsAgreement && agreementId && acceptedAt) {
        agreementPdfPath = await createAgreementPdf({
          userId,
          artistName: normalizedName,
          email: normalizedEmail,
          phone: phone ? String(phone).trim() : undefined,
          agreementVersion: String(agreementVersion),
          agreementId,
          acceptedAt,
          signatureSignedAt: acceptedAt,
          digitalSignature: String(digitalSignature),
          termsVersion: String(termsVersion),
          termsContent,
          artistRevenueShare: selectedPlans[0]?.artist_share,
          platformRevenueShare: selectedPlans[0]?.platform_share,
        });
      }

      AuditService.log({
        action: created ? "artist.onboarding_started" : "artist.onboarding_updated",
        entity: "user",
        entityId: String(userId),
        performedBy: userId,
        role: "artist",
        status: "success",
        correlationId,
        metadata: {
          agreementAccepted: wantsAgreement,
          agreementVersion: wantsAgreement ? String(agreementVersion) : null,
          termsVersion: wantsAgreement ? String(termsVersion) : null,
          agreementId,
          agreementPdfPath,
        },
      });

      return res.status(created ? 201 : 200).json({
        success: true,
        ...(token ? { token } : {}),
        pendingApproval: true,
        user: {
          id: userId,
          email: normalizedEmail,
          role: "ARTIST",
          isVerified: false,
          status: "ACTIVE",
        },
        correlationId,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    logger.error(
      { error, correlationId },
      "[artist/onboarding] Failed"
    );
    return res.status(error?.status === 400 ? 400 : 500).json({
      success: false,
      code: error?.code || "ARTIST_ONBOARDING_FAILED",
      message:
        error?.code === "SIGNATURE_ENCRYPTION_NOT_CONFIGURED"
          ? "Artist agreement service is unavailable"
          : "Failed to submit artist onboarding",
      correlationId,
    });
  }
});

export default router;
