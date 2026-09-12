import "dotenv/config";
import compression from "compression";
import express from "express";
import path from "path";
import { Server } from "http";
import { v4 as uuidv4 } from "uuid";

import { pool, poolRead } from "./common/db";
import { assertDatabaseSchemaReady } from "./common/db/schema-readiness";
import { redis } from "./common/redis";
import { logger, httpLogger } from "./common/logger";
import { initSentry, captureError } from "./common/sentry";
import { globalLimiter } from "./common/security/rateLimit";
import { requireAuth, requireVerifiedArtist } from "./common/auth/requireAuth";
import { validateEnv } from "./config/env.validation";
import fanRoutes from "./routes/fan";
import artistRoutes from "./routes/artist";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import contentRoutes from "./routes/content";
import searchRoutes from "./routes/search";
import mediaRoutes from "./routes/media";
import { razorpayWebhook } from "./controllers/paymentController";
import mediaStreamRoutes from "./modules/media/media-stream.routes";
import artistOnboardingRoutes from "./modules/artist/artist-onboarding.routes";
import artistSecurityRoutes from "./modules/artist/artist-security.routes";
import { createStorageProvider } from "./shared/storage/factory/storage-provider.factory";
import { getDeliveryStrategyForProvider } from "./shared/delivery/services/media-delivery.service";
import { MediaProviderFactory } from "./services/providers/MediaProviderFactory";
import { NotificationService } from "./shared/notifications/notification.service";
import { WinBackService } from "./shared/subscriptions/win-back.service";

initSentry();

const app = express();
const PORT = Number(process.env.PORT || 8000);

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

app.set("trust proxy", 1);

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "[Process] Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logger.fatal({ error }, "[Process] Unhandled promise rejection");
  process.exit(1);
});

app.get("/health", async (_req, res) => {
  const startedAt = Date.now();
  const checks: Record<string, unknown> = { db: "unknown", redis: "unknown" };

  try {
    await pool.query("SELECT 1");
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  const redisConfigured = Boolean(
    process.env.REDIS_URL &&
      process.env.REDIS_URL !== "" &&
      process.env.REDIS_URL !== "disabled"
  );

  if (!redisConfigured) {
    checks.redis = "disabled";
  } else {
    try {
      checks.redis = (await redis.ping()) === "PONG" ? "ok" : "degraded";
    } catch {
      checks.redis = "error";
    }
  }

  const healthy = checks.db === "ok" && ["ok", "disabled"].includes(String(checks.redis));
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    responseTimeMs: Date.now() - startedAt,
    checks,
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "error" });
  }
});

app.get("/health/redis", async (_req, res) => {
  const redisConfigured = Boolean(
    process.env.REDIS_URL &&
      process.env.REDIS_URL !== "" &&
      process.env.REDIS_URL !== "disabled"
  );
  if (!redisConfigured) return res.json({ status: "disabled" });

  try {
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error("Unexpected Redis PING response");
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "error" });
  }
});

if (process.env.NODE_ENV !== "production") app.set("etag", false);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, Cache-Control, Pragma, Expires"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Razorpay signature verification requires the exact raw request bytes. This
// route must remain before express.json().
app.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => razorpayWebhook(req as any, res)
);

app.use(compression());
app.use(express.json());
app.use(globalLimiter);
app.use(httpLogger);

// Legacy public uploads remain routable until the secure-media phase removes
// direct delivery paths. Do not use this route for new protected media.
app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));
app.use("/media/stream", mediaStreamRoutes);

app.use((req: any, res, next) => {
  const incomingCorrelationId =
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-request-id"] as string | undefined);
  const correlationId = incomingCorrelationId || uuidv4();
  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
});

app.use("/api/v1/fan", fanRoutes);
// Security-critical artist entry points are mounted before the historical
// artist router so legacy handlers cannot bypass the canonical session model.
app.use("/api/v1/artist/onboard", artistOnboardingRoutes);
app.use("/api/v1/artist/update-password", artistSecurityRoutes);

// Pending/rejected artists may still access onboarding, appeal, account-state
// and password-recovery surfaces. Business dashboard surfaces require the
// current DB account to be an approved/verified ARTIST; the web UI is not a
// security boundary.
app.use(
  [
    "/api/v1/artist/dashboard",
    "/api/v1/artist/pricing",
    "/api/v1/artist/analytics",
    "/api/v1/artist/channel-preview",
    "/api/v1/artist/uploads",
  ],
  requireAuth,
  requireVerifiedArtist
);

app.use("/api/v1/artist", artistRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/content", contentRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/media", mediaRoutes);

app.use((req: any, _res: any, next: any) => {
  const error: any = new Error(`Route not found: ${req.method} ${req.originalUrl || req.url}`);
  error.status = 404;
  next(error);
});

app.use((error: any, req: any, res: any, next: any) => {
  const correlationId = req?.correlationId || "-";
  const status = Number(error?.status || error?.statusCode || 500);

  logger.error(
    {
      correlationId,
      method: req?.method,
      url: req?.originalUrl || req?.url,
      statusCode: status,
      message: error?.message || String(error),
      stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined,
    },
    `[ERROR] ${error?.message || String(error)}`
  );

  captureError(error, {
    correlationId,
    method: req?.method,
    url: req?.originalUrl || req?.url,
    statusCode: status,
  });

  if (res.headersSent) return next(error);
  return res.status(status).json({
    success: false,
    message:
      status >= 500 && process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : error?.message || "Internal Server Error",
    correlationId,
  });
});

function startSubscriptionSchedulers(): NodeJS.Timeout[] {
  const timers: NodeJS.Timeout[] = [];

  const sweepExpiredSubscriptions = async () => {
    try {
      const result = await pool.query(`
        UPDATE subscriptions
        SET status = 'EXPIRED', updated_at = now()
        WHERE status IN ('ACTIVE', 'GRACE', 'PAST_DUE')
          AND next_billing_date IS NOT NULL
          AND next_billing_date < now()
        RETURNING id, user_id, type, artist_id
      `);

      for (const row of result.rows) {
        WinBackService.processChurnedUser(
          row.id,
          row.user_id,
          row.type,
          row.artist_id
        ).catch((error) =>
          logger.error({ error, subscriptionId: row.id }, "[WinBack] Failed")
        );
      }
    } catch (error) {
      logger.error({ error }, "[Sweeper] Subscription expiry sweep failed");
    }
  };

  const notifyExpiringSubscriptions = async () => {
    try {
      const result = await pool.query(`
        SELECT s.user_id, s.artist_id, u.name AS artist_name
        FROM subscriptions s
        LEFT JOIN users u ON u.id = s.artist_id
        WHERE s.type = 'ARTIST'
          AND s.status = 'ACTIVE'
          AND s.next_billing_date > now() + interval '47 hours'
          AND s.next_billing_date <= now() + interval '48 hours'
      `);

      for (const row of result.rows) {
        NotificationService.sendToUser({
          userId: String(row.user_id),
          title: "Subscription Expiring Soon! ⏳",
          body: `Your subscription to ${row.artist_name || "your artist"} will expire in 2 days.`,
          data: { type: "expiry_warning", artistId: row.artist_id },
        }).catch((error) =>
          logger.error({ error, userId: row.user_id }, "[Notifier] Expiry warning failed")
        );
      }
    } catch (error) {
      logger.error({ error }, "[Notifier] Expiry notification scan failed");
    }
  };

  const sweepStaleSessions = async () => {
    try {
      await pool.query(`
        DELETE FROM user_sessions
        WHERE last_active_at < now() - interval '30 days'
      `);
    } catch (error) {
      logger.error({ error }, "[Sweeper] Stale session cleanup failed");
    }
  };

  void sweepExpiredSubscriptions();
  void notifyExpiringSubscriptions();
  void sweepStaleSessions();

  timers.push(setInterval(() => void sweepExpiredSubscriptions(), 6 * 60 * 60 * 1000));
  timers.push(setInterval(() => void notifyExpiringSubscriptions(), 60 * 60 * 1000));
  timers.push(setInterval(() => void sweepStaleSessions(), 24 * 60 * 60 * 1000));
  return timers;
}

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => resolve(server));
    server.once("error", reject);
  });
}

async function bootstrap(): Promise<void> {
  logger.info({ pid: process.pid, port: PORT }, "[Startup] Booting backend");

  const storageConfig = validateEnv();
  createStorageProvider();
  getDeliveryStrategyForProvider(storageConfig.storageProvider);
  MediaProviderFactory.initialize();

  // No route, worker or scheduler may start until the explicitly migrated
  // schema matches the application contract.
  const schema = await assertDatabaseSchemaReady();
  logger.info(
    { schemaVersion: schema.version, database: schema.database, schema: schema.schema },
    "[Startup] Database schema verified"
  );

  // Worker construction is an import side effect, so defer it until DB ready.
  await import("./workers/upload.worker");
  const timers = startSubscriptionSchedulers();
  const server = await listen();

  logger.info(
    { port: PORT, storageProvider: storageConfig.storageProvider },
    "[Startup] Server accepting traffic"
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "[Shutdown] Graceful shutdown started");
    timers.forEach((timer) => clearInterval(timer));

    const forceExit = setTimeout(() => {
      logger.error("[Shutdown] Graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([pool.end(), poolRead.end(), redis.quit()]);
      logger.info("[Shutdown] Resources closed");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "[Shutdown] Failed to close resources");
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

if (require.main === module) {
  bootstrap().catch((error) => {
    logger.fatal({ error }, "[Startup] Bootstrap failed");
    process.exit(1);
  });
}

export { app, bootstrap };
