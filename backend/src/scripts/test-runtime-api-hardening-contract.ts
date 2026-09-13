import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve(__dirname, "..");
const backendRoot = path.resolve(srcRoot, "..");
const repoRoot = path.resolve(backendRoot, "..");

const source = (relativePath: string) => fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
const backend = (relativePath: string) => fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
const repo = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

function main() {
  const packageJson = backend("package.json");
  const env = source("config/env.validation.ts");
  const app = source("app.ts");
  const server = source("server.ts");
  const dependencies = source("runtime/dependencies.ts");
  const redis = source("common/redis.ts");
  const payment = source("controllers/paymentController.ts");
  const rateLimit = source("common/security/rateLimit.ts");
  const stream = source("modules/streaming/stream.routes.ts");
  const content = source("modules/content/content.routes.ts");
  const featured = source("routes/admin/featured-artists.ts");
  const audit = source("controllers/admin/adminAuditController.ts");
  const gitignore = repo(".gitignore");

  assert.equal(packageJson.includes("Build Warnings Ignored"), false, "TypeScript build failures must never be masked");
  assert.equal(packageJson.includes('"build": "npx prisma generate && tsc"'), true, "Build must fail when Prisma generation or tsc fails");
  assert.equal(packageJson.includes('"start": "node dist/server.js"'), true, "Runtime must start through the hardened server entrypoint");

  const validationIndex = server.indexOf("const runtime = validateEnv()");
  const appImportIndex = server.indexOf('import("./app")');
  const listenIndex = server.indexOf("server = await listen");
  assert.ok(validationIndex >= 0 && appImportIndex > validationIndex, "Environment validation must precede application/dependency imports");
  assert.ok(listenIndex > appImportIndex, "HTTP listener must open only after runtime/dependency initialization");
  assert.equal(server.includes('shutdown("uncaughtException", 1)'), true, "Unknown fatal errors must use controlled shutdown");
  assert.equal(server.includes("closeRedis()"), true, "Graceful shutdown must close Redis through its canonical lifecycle");

  assert.equal(app.includes("app.listen("), false, "Express composition must not own the listener");
  assert.equal(app.includes('app.get("/health"'), true, "Liveness endpoint must exist");
  assert.equal(app.includes('app.get("/health/ready"'), true, "Readiness endpoint must be separate from liveness");
  assert.equal(app.includes('Access-Control-Allow-Origin", "*"'), false, "Production CORS must not be an unconditional wildcard");

  assert.equal(env.includes('envStr("DATABASE_URL")'), true, "Database URL must be part of strict startup validation");
  assert.equal(env.includes("APP_BASE_URL must be an origin"), true, "Canonical base URL must not contain arbitrary path/query/hash");
  assert.equal(env.includes('STORAGE_PROVIDER=local is development/test only'), true, "Local storage must be rejected in production");
  assert.equal(env.includes('TRUST_PROXY_HOPS", { min: 1'), true, "Production proxy trust must be explicit and non-zero");
  assert.equal(env.includes("REDIS_URL must not target localhost in production"), true, "Production Redis must not silently target localhost");
  assert.equal(env.includes('envStr("RAZORPAY_WEBHOOK_SECRET")'), true, "Enabled payments must validate webhook secret at startup");

  assert.equal(redis.includes("process.env"), false, "Redis must consume validated runtime config, not raw environment values");
  assert.equal(redis.includes("dotenv"), false, "Redis module must not load environment independently");
  assert.equal(dependencies.includes("configureRedis(runtime.redisUrl)"), true, "Dependency startup must inject validated Redis URL");
  assert.equal(payment.includes("process.env.RAZORPAY"), false, "Payment runtime must use validated configuration");
  assert.equal(payment.includes("runtime.razorpayWebhookSecret"), true, "Webhook verification must use validated secret");

  assert.equal(rateLimit.includes('headers["x-forwarded-for"]'), false, "Rate limiting must rely on Express trusted-proxy IP resolution");
  assert.equal(rateLimit.includes('code: "RATE_LIMITED"'), true, "429 responses need stable semantics");
  assert.equal(rateLimit.includes("paymentLimiter"), true, "Payment abuse control must exist");
  assert.equal(rateLimit.includes("playbackAccessLimiter"), true, "Playback-access abuse control must exist");
  assert.equal(rateLimit.includes("playbackHeartbeatLimiter"), true, "Heartbeat abuse control must exist");
  assert.equal(stream.includes("playbackAccessLimiter"), true, "Playback access limiter must be wired");
  assert.equal(stream.includes("playbackHeartbeatLimiter"), true, "Heartbeat limiter must be wired");

  assert.equal(stream.includes('req.get("host")'), false, "Protected playback URL must not depend on Host header");
  assert.equal(content.includes('req.get("host")'), false, "Catalog public links must not depend on Host header");
  assert.equal(content.includes("publicAppUrl"), true, "Catalog artwork must use trusted APP_BASE_URL");
  assert.equal(featured.includes('req.get("host")'), false, "Featured artist links must not depend on Host header");
  assert.equal(featured.includes("canonicalPublicUrl"), true, "Featured artist assets must use trusted URL construction");

  assert.equal(content.includes("LIMIT 500"), false, "Artist content lists must not use large fixed limits");
  assert.equal(content.includes("LIMIT $3 OFFSET $4"), true, "Artist content list must have bounded pagination");
  assert.equal(audit.includes("parsed <= 100"), true, "Audit page size must be capped at 100");
  assert.equal(audit.includes("INVALID_PAGINATION"), true, "Invalid pagination must have stable 400 semantics");
  assert.equal(audit.includes("ORDER BY created_at DESC, id DESC"), true, "Audit pagination must have deterministic ordering");

  assert.equal(gitignore.includes(".env.*"), true, "Secret-bearing env variants must be ignored");
  assert.equal(gitignore.includes("!**/.env.example"), true, "Only sanitized env examples should remain trackable");

  console.log("Runtime/API hardening contract checks passed.");
}

main();
