import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Response } from "express";
import { pool } from "../../common/db";
import { AuditService } from "../../shared/audit/audit.service";

function requestDeviceId(req: any) {
  const headerValue = req.headers?.["x-device-id"];
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return String(value || "").trim();
}

export async function updatePasswordAndRotateSession(req: any, res: Response) {
  const userId = Number(req.user?.id);
  const correlationId = req?.correlationId || "-";
  const { oldPassword, newPassword } = req.body ?? {};
  const deviceId = requestDeviceId(req);
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

  if (!deviceId || deviceId.length > 255) {
    return res.status(400).json({
      success: false,
      code: "DEVICE_ID_REQUIRED",
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

    // Password change revokes every pre-change token. A new session is created
    // for the verified current device and the client receives a replacement JWT.
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    const sessionResult = await client.query(
      `INSERT INTO user_sessions (user_id, device_id, device_name, last_active_at)
       VALUES ($1, $2, $3, now())
       RETURNING id`,
      [userId, deviceId, String(req.headers?.["user-agent"] || "Current device")]
    );
    const sessionId = Number(sessionResult.rows?.[0]?.id);

    await client.query("COMMIT");

    const role = String(user.role || "FAN").toUpperCase();
    const token = jwt.sign(
      { id: userId, email: user.email, role, sid: sessionId },
      secret,
      { expiresIn: "1d" }
    );

    AuditService.log({
      action: "user.password_changed",
      entity: "user",
      entityId: String(userId),
      performedBy: userId,
      role: role.toLowerCase() as any,
      status: "success",
      correlationId,
      metadata: { allPreviousSessionsRevoked: true },
    });

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
