import compression from "compression";
import express, { type RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";

import { pool } from "./common/db";
import { redis } from "./common/redis";
import { logger, httpLogger } from "./common/logger";
import { captureError } from "./common/sentry";
import { globalLimiter } from "./common/security/rateLimit";
import { requireAuth, requireVerifiedArtist } from "./common/auth/requireAuth";
import type { EnvValidationResult } from "./config/env.validation";
import fanRoutes from "./routes/fan";
import artistRoutes from "./routes/artist";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import contentRoutes from "./routes/content";
import searchRoutes from "./routes/search";
import mediaRoutes from "./routes/media";
import { razorpayWebhook } from "./controllers/paymentController";
import { handleMediaWebhook } from "./controllers/media/WebhookController";
import adaptiveMediaStreamRoutes from "./modules/media/adaptive-media-stream.routes";
import mediaStreamRoutes from "./modules/media/media-stream.routes";
import artistOnboardingRoutes from "./modules/artist/artist-onboarding.routes";
import artistSecurityRoutes from "./modules/artist/artist-security.routes";
import artistAnalyticsRoutes from "./modules/artist/artist-analytics.routes";
import artistPricingRoutes from "./modules/artist/artist-pricing.routes";
import { validateArtistPricingRequest } from "./modules/artist/artist-pricing.validation";
import {
  artistAssetUploadRouter,
  artistPublicAssetRouter,
} from "./modules/artist/artist-assets.routes";

function corsMiddleware(runtime: EnvValidationResult): RequestHandler {
  const allowAll = runtime.corsAllowedOrigins.includes("*");
  const allowed = new Set(runtime.corsAllowedOrigins);

  return (req: any, res: any, next: any) => {
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    const originAllowed = !origin || allowAll || allowed.has(origin);

    if (origin && originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
      if (!allowAll) res.append("Vary", "Origin");
    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, X-Correlation-Id, Cache-Control, Pragma, Expires"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

    if (req.method === "OPTIONS") {
      if (!originAllowed) {
        return res.status(403).json({ success: false, code: "CORS_ORIGIN_FORBIDDEN", message: "Origin is not allowed" });
      }
      return res.sendStatus(204);
    }

    return next();
  };
}

export function createApp(runtime: EnvValidationResult) {
  const app = express();
  app.set("trust proxy", runtime.trustProxyHops);
  if (runtime.nodeEnv !== "production") app.set("etag", false);

  app.use(corsMiddleware(runtime));

  app.use((req: any, res, next) => {
    const incomingCorrelationId =
      (req.headers["x-correlation-id"] as string | undefined) ||
      (req.headers["x-request-id"] as string | undefined);
    const correlationId = incomingCorrelationId || uuidv4();
    req.correlationId = correlationId;
    res.setHeader("X-Correlation-Id", correlationId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Liveness reveals only process state. It intentionally does not query or
  // identify internal dependencies.
  app.get("/health", (_req, res) =>
    res.json({ status: "alive", uptimeSeconds: Math.floor(process.uptime()) })
  );
  app.get("/health/live", (_req, res) =>
    res.json({ status: "alive", uptimeSeconds: Math.floor(process.uptime()) })
  );

  // Readiness checks only critical serving state. Redis is an optional cache;
  // when configured but unavailable it is reported as degraded without making
  // DB-backed request handling falsely unavailable.
  app.get("/health/ready", async (_req, res) => {
    let database: "ok" | "error" = "error";
    let cache: "disabled" | "ok" | "degraded" = runtime.redisUrl ? "degraded" : "disabled";

    try {
      await pool.query("SELECT 1");
      database = "ok";
    } catch {
      database = "error";
    }

    if (runtime.redisUrl && redis) {
      try {
        cache = (await redis.ping()) === "PONG" ? "ok" : "degraded";
      } catch {
        cache = "degraded";
      }
    }

    const ready = database === "ok";
    return res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies: { database, cache },
    });
  });

  // Provider signatures cover exact raw bytes. Webhooks intentionally bypass
  // generic rate limiting; signature verification + idempotency are their abuse boundary.
  app.post(
    "/api/v1/payments/webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req, res) => razorpayWebhook(req as any, res)
  );
  app.post(
    "/api/v1/media/webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req, res) => handleMediaWebhook(req as any, res)
  );

  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(globalLimiter);
  app.use(httpLogger);

  // Adaptive Cloudinary video is intercepted first so manifests/segments remain
  // session-bound. All non-adaptive/progressive media continues through the
  // existing Phase-02 protected stream boundary.
  app.use("/media/stream", adaptiveMediaStreamRoutes);
  app.use("/media/stream", mediaStreamRoutes);

  app.use("/api/v1/fan", fanRoutes);
  app.use("/api/v1/artist/onboard", artistOnboardingRoutes);
  app.use("/api/v1/artist/update-password", artistSecurityRoutes);
  app.use("/api/v1/artist/uploads", artistAssetUploadRouter);
  app.use("/api/v1/artist/assets", artistPublicAssetRouter);

  app.use(
    [
      "/api/v1/artist/dashboard",
      "/api/v1/artist/pricing",
      "/api/v1/artist/analytics",
      "/api/v1/artist/channel-preview",
    ],
    requireAuth,
    requireVerifiedArtist
  );

  // Phase-1 Artist pricing remains a server-validated control-plane command.
  // This boundary normalizes supported rupee values before the authoritative
  // Phase 08 pricing route persists them transactionally with its audit record.
  app.patch("/api/v1/artist/pricing", validateArtistPricingRequest);

  app.use("/api/v1/artist", artistPricingRoutes);

  // Phase 08 moves all artist analytics/dashboard metrics onto a strict,
  // ownership-scoped boundary before the legacy artist router. Query failures
  // remain visible and earnings are sourced only from captured payment ledger
  // rows; listening analytics never becomes a payout authority.
  app.use("/api/v1/artist", artistAnalyticsRoutes);
  app.use("/api/v1/artist", artistRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/content", contentRoutes);
  app.use("/api/v1/search", searchRoutes);
  app.use("/api/v1/media", mediaRoutes);

  app.use((req: any, _res: any, next: any) => {
    const error: any = new Error("Route not found");
    error.status = 404;
    error.code = "ROUTE_NOT_FOUND";
    error.requestPath = req.originalUrl || req.url;
    next(error);
  });

  app.use((error: any, req: any, res: any, next: any) => {
    const correlationId = req?.correlationId || "-";
    const rawStatus = Number(error?.status || error?.statusCode || 500);
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const code = String(error?.code || (status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR"));

    logger.error(
      {
        correlationId,
        method: req?.method,
        path: req?.originalUrl || req?.url,
        statusCode: status,
        code,
        message: error?.message || String(error),
        stack: runtime.nodeEnv !== "production" ? error?.stack : undefined,
      },
      "[HTTP] Request failed"
    );

    if (status >= 500) {
      captureError(error, {
        correlationId,
        method: req?.method,
        path: req?.originalUrl || req?.url,
        statusCode: status,
        code,
      });
    }

    if (res.headersSent) return next(error);
    return res.status(status).json({
      success: false,
      code,
      message:
        status >= 500 && runtime.nodeEnv === "production"
          ? "Internal Server Error"
          : error?.message || "Request failed",
      correlationId,
    });
  });

  return app;
}