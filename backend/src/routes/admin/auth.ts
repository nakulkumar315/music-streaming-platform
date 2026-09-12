import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../../common/db";
import { authLimiter } from "../../common/security/rateLimit";
import { SessionService } from "../../common/auth/session.service";

const router = Router();
const PRIVILEGED_ROLES = new Set(["ADMIN", "MODERATOR", "FINANCE"]);

router.post("/login", authLimiter, async (req, res) => {
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
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const userResult = await pool.query(
      `SELECT id, email, password, role, status, is_deleted
         FROM users
        WHERE email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = userResult.rows?.[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }

    const role = String(user.role || "").toUpperCase();
    if (!PRIVILEGED_ROLES.has(role)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "This account cannot access the administration portal",
      });
    }

    if (user.is_deleted === true || String(user.status || "").toUpperCase() !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        message: "Account is not available",
      });
    }

    const session = await SessionService.createSession({
      userId: Number(user.id),
      deviceId,
      deviceName: deviceName || String(req.headers["user-agent"] || "Admin browser"),
      maxActiveSessions: null,
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      await SessionService.revokeSession(Number(user.id), session.id);
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      { id: Number(user.id), email: user.email, role, sid: session.id },
      secret,
      { expiresIn: "1d" }
    );

    return res.json({
      success: true,
      token,
      user: { id: Number(user.id), email: user.email, role },
    });
  } catch (error: any) {
    if (error?.code === "DEVICE_ID_REQUIRED" || error?.code === "INVALID_DEVICE_ID") {
      return res.status(400).json({
        success: false,
        code: error.code,
        message: "Unable to identify this browser session",
      });
    }

    console.error("[ADMIN LOGIN] authentication failed");
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;
