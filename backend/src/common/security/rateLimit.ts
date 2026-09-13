import rateLimit from "express-rate-limit";
import crypto from "crypto";

function clientIp(req: any): string {
  // Express derives req.ip from socket + the explicitly configured trust-proxy
  // policy. Never parse X-Forwarded-For ourselves.
  return String(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown");
}

function userOrIpKey(req: any, prefix: string): string {
  const userId = Number(req.user?.id);
  if (Number.isSafeInteger(userId) && userId > 0) return `${prefix}:user:${userId}`;
  return `${prefix}:ip:${clientIp(req)}`;
}

function authKey(req: any): string {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return `auth:ip:${clientIp(req)}`;
  const subject = crypto.createHash("sha256").update(email).digest("hex").slice(0, 16);
  return `auth:ip:${clientIp(req)}:subject:${subject}`;
}

const rateLimitHandler = (req: any, res: any) => {
  const correlationId = req?.correlationId || "-";
  return res.status(429).json({
    success: false,
    code: "RATE_LIMITED",
    message: "Too many requests, please try again later.",
    correlationId,
  });
};

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => clientIp(req),
  handler: rateLimitHandler,
});

export const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKey,
  handler: rateLimitHandler,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => userOrIpKey(req, "upload"),
  handler: rateLimitHandler,
});

export const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => userOrIpKey(req, "payment"),
  handler: rateLimitHandler,
});

export const playbackAccessLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => userOrIpKey(req, "playback-access"),
  handler: rateLimitHandler,
});

export const playbackHeartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => userOrIpKey(req, "playback-heartbeat"),
  handler: rateLimitHandler,
});
