import "dotenv/config";
import type { Server } from "http";
import type { Express } from "express";
import { validateEnv } from "./config/env.validation";

function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once("error", reject);
  });
}

export async function startServer(): Promise<void> {
  // Validation is deliberately the first runtime action. Everything that can
  // import DB/provider/business modules is loaded only after this succeeds.
  const runtime = validateEnv();

  const [{ logger }, { initSentry }] = await Promise.all([
    import("./common/logger"),
    import("./common/sentry"),
  ]);
  initSentry(runtime);
  logger.info({ pid: process.pid, port: runtime.port }, "[Startup] Runtime configuration validated");

  const [{ initializeDependencies }, { createApp }, { startSubscriptionSchedulers }] = await Promise.all([
    import("./runtime/dependencies"),
    import("./app"),
    import("./runtime/subscription-schedulers"),
  ]);

  const dependencies = await initializeDependencies(runtime);
  logger.info(
    {
      schemaVersion: dependencies.schemaVersion,
      cache: dependencies.cache,
      storageProvider: runtime.storageProvider,
    },
    "[Startup] Critical dependencies initialized"
  );

  const app = createApp(runtime);
  const schedulers = startSubscriptionSchedulers();
  let server: Server | null = null;
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason, exitCode }, "[Shutdown] Controlled shutdown started");
    schedulers.stop();

    const forceExit = setTimeout(() => {
      logger.error({ reason }, "[Shutdown] Graceful shutdown timed out");
      process.exit(exitCode || 1);
    }, 10_000);
    forceExit.unref();

    try {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }

      const [{ pool, poolRead }, { redis }] = await Promise.all([
        import("./common/db"),
        import("./common/redis"),
      ]);
      const closers: Promise<unknown>[] = [pool.end(), poolRead.end()];
      if (redis) closers.push(redis.quit());
      await Promise.allSettled(closers);
      clearTimeout(forceExit);
      logger.info({ reason }, "[Shutdown] Resources closed");
      process.exit(exitCode);
    } catch (error) {
      clearTimeout(forceExit);
      logger.error({ error, reason }, "[Shutdown] Resource shutdown failed");
      process.exit(exitCode || 1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.once("SIGINT", () => void shutdown("SIGINT", 0));
  process.once("uncaughtException", (error) => {
    logger.fatal({ error }, "[Process] Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", (error) => {
    logger.fatal({ error }, "[Process] Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });

  try {
    server = await listen(app, runtime.port);
  } catch (error) {
    schedulers.stop();
    throw error;
  }

  if (typeof process.send === "function") process.send("ready");
  logger.info(
    { port: runtime.port, storageProvider: runtime.storageProvider, cache: dependencies.cache },
    "[Startup] Server accepting traffic"
  );
}

if (require.main === module) {
  startServer().catch(async (error) => {
    // Logger/config dependencies may not be available when validation itself fails.
    console.error("[Startup] Backend failed before becoming ready", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
