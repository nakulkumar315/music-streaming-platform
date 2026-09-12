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
      if (!normalizedEmail || !password) {
        return { success: false, message: "Email and password required" };
      }

      const existingUser = await pool.query(
        "SELECT id FROM public.users WHERE email = $1",
        [normalizedEmail]
      );

      if (existingUser.rows.length > 0) {
        return { success: false, message: "Email already exists" };
      }

      const hashedPassword = await bcrypt.hash(password, 10);
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

    const userResult = await pool.query(
      `SELECT id, email, password, status, role, is_verified, is_deleted
         FROM public.users
        WHERE email = $1`,
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
    const isDeleted = user.is_deleted === true;

    if (!role || isDeleted || status !== "ACTIVE") {
      throw authError("Account is not available", 403, "ACCOUNT_INACTIVE");
    }

    const session = await SessionService.createSession({
      userId: Number(user.id),
      deviceId,
      deviceName,
      maxActiveSessions: 2,
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      await SessionService.revokeSession(Number(user.id), session.id);
      throw new Error("JWT_SECRET is not configured");
    }

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

    return {
      success: true,
      token,
      pendingApproval: role === "ARTIST" && !isVerified,
      user: {
        id: Number(user.id),
        email: user.email,
        role,
        isVerified,
        status,
      },
    };
  }

  async logout(userId: number, sessionId: number) {
    await SessionService.revokeSession(userId, sessionId);
    return { success: true };
  }

  async removeSession(userId: number, deviceId: string) {
    await SessionService.revokeDeviceSession(userId, deviceId);
    return { success: true };
  }
}
