import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PoolClient } from "pg";
import { pool } from "../../common/db";
import { requireAuth } from "../../common/auth/requireAuth";
import { authLimiter } from "../../common/security/rateLimit";
import { SessionService } from "../../common/auth/session.service";
import { AuditService } from "../../shared/audit/audit.service";

const router = Router();
const PRIVILEGED_ROLES = new Set(["ADMIN", "MODERATOR", "FINANCE"]);

router.post("/login", authLimiter, async (req, res) => {
  let client: PoolClient | null = null;

  try {
    const { email, password, deviceId: bodyDeviceId, deviceName } = req.body as {
      email?: string;
      password?: string;
      deviceId?: string;
      deviceName?: string;
    };

    const headerDeviceId = req.headers["x-device-id"];
    const deviceId = String(
      bodyDeviceId || (Array.isArray(headerDeviceId) ? headerDeviceId[0] : headerDeviceId) || ""
    );

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");

    client = await pool.connect();
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, email, password, role, status, is_deleted
         FROM users
        WHERE email = $1
        FOR UPDATE`,
      [email.trim().toLowerCase()]
    );
    const user = userResult.rows?.[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }

    const role = String(user.role || "").toUpperCase();
    if (!PRIVILEGED_ROLES.has(role)) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    }

    if (user.is_deleted === true || String(user.status || "").toUpperCase() !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, code: "ACCOUNT_INACTIVE", message: "Account is not available" });
    }

    const session = await SessionService.createSessionInTransaction(client, {
      userId: Number(user.id),
      deviceId,
      deviceName: deviceName || String(req.headers["user-agent"] || "Admin browser"),
      maxActiveSessions: null,
    });

    const token = jwt.sign(
      { id: Number(user.id), email: user.email, role, sid: session.id },
      secret,
      { expiresIn: "1d" }
    );

    await client.query("COMMIT");

    AuditService.log({
      action: "admin.login",
      entity: "user_session",
      entityId: String(session.id),
      performedBy: Number(user.id),
      role: role.toLowerCase() as any,
      status: "success",
      correlationId: (req as any)?.correlationId || "-",
    });

    return res.json({ success: true, token, user: { id: Number(user.id), email: user.email, role } });
  } catch (error: any) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);

    if (error?.code === "DEVICE_ID_REQUIRED" || error?.code === "INVALID_DEVICE_ID") {
      return res.status(400).json({ success: false, code: error.code, message: "Unable to identify this browser session" });
    }

    console.error("[ADMIN LOGIN] authentication failed");
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client?.release();
  }
});

router.get("/session", requireAuth, (req: any, res) => {
  const role = String(req.user?.role || "").toUpperCase();
  if (!PRIVILEGED_ROLES.has(role)) {
    return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Access forbidden" });
  }
  return res.json({
    success: true,
    user: {
      id: Number(req.user.id),
      email: String(req.user.email),
      role,
      status: String(req.user.status || "ACTIVE").toUpperCase(),
    },
  });
});

router.post("/logout", requireAuth, async (req: any, res) => {
  const userId = Number(req.user?.id);
  const sessionId = Number(req.user?.sessionId);
  const role = String(req.user?.role || "").toUpperCase();

  if (!userId || !sessionId || !PRIVILEGED_ROLES.has(role)) {
    return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Access forbidden" });
  }

  await SessionService.revokeSession(userId, sessionId);
  AuditService.log({
    action: "admin.logout",
    entity: "user_session",
    entityId: String(sessionId),
    performedBy: userId,
    role: role.toLowerCase() as any,
    status: "success",
    correlationId: req?.correlationId || "-",
  });

  return res.json({ success: true });
});

export default router;
