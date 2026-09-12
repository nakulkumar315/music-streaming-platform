import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../../common/db";
import { SessionService } from "../../common/auth/session.service";

function authError(message: string, status: number, code: string) {
  const error: any = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export class AuthService {
  async register(email: string, password: string, name?: string) {
    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const rawPassword = String(password || "");
      if (!normalizedEmail || rawPassword.length < 6 || rawPassword.length > 128) {
        return { success: false, message: "Valid email and password are required" };
      }

      const existingUser = await pool.query(
        "SELECT id FROM public.users WHERE email = $1",
        [normalizedEmail]
      );

      if (existingUser.rows.length > 0) {
        return { success: false, message: "Email already exists" };
      }

      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const normalizedName = name ? String(name).trim() : null;

      await pool.query(
        `INSERT INTO public.users (email, password, name, role, status, is_deleted)
         VALUES ($1, $2, $3, 'FAN', 'ACTIVE', false)`,
        [normalizedEmail, hashedPassword, normalizedName]
      );

      return { success: true, message: "User registered successfully" };
    } catch {
      return { success: false, message: "Registration failed" };
    }
  }

  async login(
    email: string,
    password: string,
    deviceId: string,
    deviceName?: string | null
  ) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw authError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Credential verification and session creation share one transaction and
      // one user-row lock. Password change takes the same lock first, so an
      // in-flight old-password login can never create a session after password
      // rotation has committed.
      const userResult = await client.query(
        `SELECT id, email, password, status, role, is_verified, artist_status, is_deleted
           FROM public.users
          WHERE email = $1
          FOR UPDATE`,
        [normalizedEmail]
      );

      const user = userResult.rows?.[0] as any;
      if (!user) {
        throw authError("Invalid credentials", 401, "INVALID_CREDENTIALS");
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw authError("Invalid credentials", 401, "INVALID_CREDENTIALS");
      }

      const role = String(user.role || "").toUpperCase();
      const status = String(user.status || "").toUpperCase();
      const isVerified = user.is_verified === true;
      const artistStatus = user.artist_status ? String(user.artist_status).toUpperCase() : null;
      const isDeleted = user.is_deleted === true;

      // The shared /auth surface is intentionally limited to FAN/ARTIST. ADMIN,
      // MODERATOR and FINANCE identities must use the privileged admin login so
      // portal-specific controls cannot be bypassed through a consumer endpoint.
      if (role !== "FAN" && role !== "ARTIST") {
        throw authError("Invalid credentials", 401, "INVALID_CREDENTIALS");
      }

      if (isDeleted || status !== "ACTIVE") {
        throw authError("Account is not available", 403, "ACCOUNT_INACTIVE");
      }

      const session = await SessionService.createSessionInTransaction(client, {
        userId: Number(user.id),
        deviceId,
        deviceName,
        maxActiveSessions: 2,
      });

      const token = jwt.sign(
        {
          id: Number(user.id),
          email: user.email,
          role,
          sid: session.id,
        },
        secret,
        { expiresIn: "1d" }
      );

      await client.query("COMMIT");

      return {
        success: true,
        token,
        pendingApproval:
          role === "ARTIST" && (isVerified !== true || artistStatus !== "APPROVED"),
        user: {
          id: Number(user.id),
          email: user.email,
          role,
          isVerified,
          artistStatus,
          status,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(userId: number, sessionId: number) {
    await SessionService.revokeSession(userId, sessionId);
    return { success: true };
  }

  async listSessions(userId: number, currentSessionId: number) {
    return SessionService.listSessions(userId, currentSessionId);
  }

  async revokeSession(userId: number, sessionId: number) {
    return SessionService.revokeSession(userId, sessionId);
  }

  async logoutAll(userId: number) {
    await SessionService.revokeAllSessions(userId);
    return { success: true };
  }
}
