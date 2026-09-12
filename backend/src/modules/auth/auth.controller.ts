import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { AuditService } from "../../shared/audit/audit.service";

const authService = new AuthService();

function requestDeviceId(req: Request) {
  const bodyDeviceId = req.body?.deviceId;
  const headerDeviceId = req.headers["x-device-id"];
  const candidate = bodyDeviceId ?? headerDeviceId;
  return Array.isArray(candidate) ? candidate[0] : candidate;
}

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, name, fullName } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password required",
        });
      }

      const result = await authService.register(email, password, name || fullName);
      return res.status(result.success ? 201 : 400).json(result);
    } catch {
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }

  async login(req: Request, res: Response) {
    const correlationId = (req as any)?.correlationId || "-";

    try {
      const { email, password, deviceName } = req.body;
      const deviceId = requestDeviceId(req);
      const result = await authService.login(
        email,
        password,
        String(deviceId || ""),
        deviceName || String(req.headers["user-agent"] || "")
      );

      const role = result.user.role;
      const userId = result.user.id;

      AuditService.log({
        action: "user.login",
        entity: "user",
        entityId: String(userId),
        performedBy: userId,
        role: role.toLowerCase() as any,
        status: "success",
        correlationId,
        metadata: { deviceId: String(deviceId) },
      });

      return res.json(result);
    } catch (err: any) {
      AuditService.log({
        action: "auth.failed_login",
        entity: "user",
        entityId: "unauthenticated",
        performedBy: undefined,
        role: "system",
        status: "failed",
        correlationId,
        metadata: { code: err?.code || "INVALID_CREDENTIALS" },
      });

      const status = err?.status === 400 || err?.status === 403 ? err.status : 401;
      const code =
        err?.code === "DEVICE_LIMIT_REACHED" ||
        err?.code === "DEVICE_ID_REQUIRED" ||
        err?.code === "INVALID_DEVICE_ID" ||
        err?.code === "ACCOUNT_INACTIVE"
          ? err.code
          : "INVALID_CREDENTIALS";

      return res.status(status).json({
        success: false,
        code,
        message:
          code === "DEVICE_LIMIT_REACHED"
            ? "Device limit reached. Please log out from another device first."
            : code === "DEVICE_ID_REQUIRED" || code === "INVALID_DEVICE_ID"
              ? "Unable to identify this device"
              : code === "ACCOUNT_INACTIVE"
                ? "Account is not available"
                : "Invalid email or password",
      });
    }
  }

  async logout(req: any, res: Response) {
    const userId = Number(req.user?.id);
    const sessionId = Number(req.user?.sessionId);

    if (!userId || !sessionId) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    await authService.logout(userId, sessionId);
    AuditService.log({
      action: "user.logout",
      entity: "user_session",
      entityId: String(sessionId),
      performedBy: userId,
      role: String(req.user?.role || "fan").toLowerCase() as any,
      status: "success",
      correlationId: req?.correlationId || "-",
    });

    return res.json({ success: true });
  }

  async logoutAll(req: any, res: Response) {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    await authService.logoutAll(userId);
    AuditService.log({
      action: "user.logout_all",
      entity: "user_session",
      entityId: String(userId),
      performedBy: userId,
      role: String(req.user?.role || "fan").toLowerCase() as any,
      status: "success",
      correlationId: req?.correlationId || "-",
    });
    return res.json({ success: true });
  }

  async sessions(req: any, res: Response) {
    const userId = Number(req.user?.id);
    const currentSessionId = Number(req.user?.sessionId);
    if (!userId || !currentSessionId) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    const sessions = await authService.listSessions(userId, currentSessionId);
    return res.json({ success: true, sessions });
  }

  async revokeSession(req: any, res: Response) {
    const userId = Number(req.user?.id);
    const sessionId = Number(req.params?.sessionId);
    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION_ID",
        message: "Session id is invalid",
      });
    }

    const revoked = await authService.revokeSession(userId, sessionId);
    if (!revoked) {
      // User-scoped delete deliberately does not reveal another user's session.
      return res.status(404).json({
        success: false,
        code: "SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }

    AuditService.log({
      action: "user.session_revoked",
      entity: "user_session",
      entityId: String(sessionId),
      performedBy: userId,
      role: String(req.user?.role || "fan").toLowerCase() as any,
      status: "success",
      correlationId: req?.correlationId || "-",
    });
    return res.json({ success: true, revokedSessionId: sessionId });
  }

  async session(req: any, res: Response) {
    const user = req.user;
    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        fullName: user.name ?? null,
        role: user.role,
        isVerified: user.isVerified,
        status: user.status,
      },
    });
  }
}
