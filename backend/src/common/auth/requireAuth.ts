import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { SessionService } from "./session.service";
export { requireRoles } from "./requireRoles";

export type AuthenticatedUser = {
  id: number;
  email: string;
  role: string;
  status: string;
  isVerified: boolean;
  artistStatus?: string | null;
  sessionId: number;
  name?: string | null;
};

type TokenPayload = jwt.JwtPayload & {
  id?: number;
  userId?: number;
  email?: string;
  role?: string;
  sid?: number;
};

function getBearerToken(authorization: unknown) {
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function resolveAuthenticatedUser(token: string): Promise<AuthenticatedUser> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const decoded = jwt.verify(token, secret) as TokenPayload;
  const userId = Number(decoded?.id ?? decoded?.userId);
  const sessionId = Number(decoded?.sid);

  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
    const error: any = new Error("Invalid token payload");
    error.status = 401;
    error.code = "INVALID_SESSION";
    throw error;
  }

  const activeSession = await SessionService.assertActiveSession(sessionId, userId);
  if (!activeSession) {
    const error: any = new Error("Session is no longer active");
    error.status = 401;
    error.code = "SESSION_REVOKED";
    throw error;
  }

  const result = await pool.query(
    `SELECT id, email, name, role, status, is_verified, artist_status, is_deleted
       FROM public.users
      WHERE id = $1`,
    [userId]
  );
  const user = result.rows?.[0];

  if (!user) {
    const error: any = new Error("Account is unavailable");
    error.status = 401;
    error.code = "ACCOUNT_NOT_FOUND";
    throw error;
  }

  const role = String(user.role || "").toUpperCase();
  const status = String(user.status || "").toUpperCase();
  const isDeleted = user.is_deleted === true;

  if (!role || isDeleted || status !== "ACTIVE") {
    const error: any = new Error("Account is not active");
    error.status = 403;
    error.code = "ACCOUNT_INACTIVE";
    throw error;
  }

  return {
    id: Number(user.id),
    email: String(user.email),
    name: user.name ?? null,
    role,
    status,
    isVerified: user.is_verified === true,
    artistStatus: user.artist_status ? String(user.artist_status).toUpperCase() : null,
    sessionId,
  };
}

function sendAuthError(res: Response, error: any) {
  const status = error?.status === 403 ? 403 : 401;
  const code =
    status === 403
      ? error?.code || "FORBIDDEN"
      : error?.code === "SESSION_REVOKED"
        ? "SESSION_REVOKED"
        : "UNAUTHORIZED";

  return res.status(status).json({
    success: false,
    code,
    message: status === 403 ? "Account is not permitted to access this resource" : "Authentication required",
  });
}

export const requireAuth = async (req: any, res: Response, next: NextFunction) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    req.user = await resolveAuthenticatedUser(token);
    return next();
  } catch (error: any) {
    return sendAuthError(res, error);
  }
};

/**
 * Optional authentication never grants access based only on JWT claims. A token
 * is treated as authenticated only when both its server session and current user
 * state are valid. Invalid/revoked optional tokens are treated as guest access.
 */
export const optionalAuth = async (req: any, _res: Response, next: NextFunction) => {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return next();
    req.user = await resolveAuthenticatedUser(token);
  } catch {
    req.user = undefined;
  }
  return next();
};

export const requireVerifiedArtist = (req: any, res: Response, next: NextFunction) => {
  const role = String(req.user?.role || "").toUpperCase();
  const artistStatus = String(req.user?.artistStatus || "").toUpperCase();

  if (role !== "ARTIST" || req.user?.isVerified !== true || artistStatus !== "APPROVED") {
    return res.status(403).json({
      success: false,
      code: "ARTIST_NOT_APPROVED",
      message: "Artist approval is required",
    });
  }
  return next();
};
