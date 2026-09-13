import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Response } from "express";
import { normalizeDeviceId, SessionService } from "../../common/auth/session.service";
import { pool } from "../../common/db";
import { AuditService } from "../../shared/audit/audit.service";

type AuditRole = "fan" | "artist" | "admin" | "finance" | "moderator" | "system";

function requestDeviceId(req: any) {
  const bodyValue = req.body?.deviceId;
  const headerValue = req.headers?.["x-device-id"];
  const candidate = bodyValue ?? (Array.isArray(headerValue) ? headerValue[0] : headerValue);
  return normalizeDeviceId(String(candidate || ""));
}

function auditRole(role: string): AuditRole {
  const normalized = role.toLowerCase();
  if (
    normalized === "fan" ||
    normalized === "artist" ||
    normalized === "admin" ||
    normalized === "finance" ||
    normalized === "moderator"
  ) {
    return normalized;
  }
  return "system";
}

export async function updatePasswordAndRotateSession(req: any, res: Response) {
  const userId = Number(req.user?.id);
  const correlationId = req?.correlationId || "-";
  const { oldPassword, newPassword } = req.body ?? {};
  const secret = process.env.JWT_SECRET;

  if (!userId) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Both old and new passwords are required",
    });
  }

  if (String(newPassword).length < 6 || String(newPassword).length > 128) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "New password must be between 6 and 128 characters",
    });
  }

  if (String(oldPassword) === String(newPassword)) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "New password must be different from the current password",
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
    });
  }

  if (!secret) {
    return res.status(500).json({
      success: false,
      code: "SYSTEM_ERROR",
      message: "Authentication service is unavailable",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Login uses the same user-row -> session-advisory lock order. This prevents
    // an old-password login already in flight from creating a surviving session
    // after password rotation commits.
    const userResult = await client.query(
      `SELECT id, email, password, role, status, is_deleted
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows?.[0];

    if (
      !user ||
      user.is_deleted === true ||
      String(user.status || "").toUpperCase() !== "ACTIVE"
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        message: "Account is not available",
      });
    }

    const passwordMatches = await bcrypt.compare(String(oldPassword), user.password);
    if (!passwordMatches) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        code: "INVALID_CURRENT_PASSWORD",
        message: "Current password is incorrect",
      });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await client.query(
      "UPDATE users SET password = $1, updated_at = now() WHERE id = $2",
      [passwordHash, userId]
    );

    // Revoke every pre-change session, then create exactly one replacement
    // session using the same canonical device validation and advisory lock as
    // normal login.
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    const session = await SessionService.createSessionInTransaction(client, {
      userId,
      deviceId,
      deviceName: String(req.headers?.["user-agent"] || "Current device"),
      maxActiveSessions: 2,
    });

    const role = String(user.role || "FAN").toUpperCase();
    const token = jwt.sign(
      { id: userId, email: user.email, role, sid: session.id },
      secret,
      { expiresIn: "1d" }
    );

    await AuditService.logCritical(
      {
        action: "user.password_changed",
        entity: "user",
        entityId: String(userId),
        performedBy: userId,
        role: auditRole(role),
        status: "success",
        correlationId,
        metadata: { allPreviousSessionsRevoked: true, replacementSessionId: session.id },
      },
      client
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Password updated successfully",
      token,
      sessionRotated: true,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[AUTH] Password rotation failed", { correlationId, userId });
    return res.status(500).json({
      success: false,
      code: "SYSTEM_ERROR",
      message: "Unable to update password",
    });
  } finally {
    client.release();
  }
}