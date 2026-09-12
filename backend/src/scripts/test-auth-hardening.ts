import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { requireRoles } from "../common/auth/requireRoles";

const srcRoot = path.resolve(__dirname, "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function evaluateGuard(roles: string[], actualRole?: string) {
  let nextCalled = false;
  let statusCode = 200;
  let body: any = null;

  const req = { user: actualRole ? { role: actualRole } : undefined };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  requireRoles(...roles)(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, body };
}

function testRoleGuards() {
  assert.equal(evaluateGuard(["ADMIN"], "ADMIN").nextCalled, true);
  assert.equal(evaluateGuard(["ADMIN"], "FAN").statusCode, 403);
  assert.equal(evaluateGuard(["ADMIN", "MODERATOR"], "MODERATOR").nextCalled, true);
  assert.equal(evaluateGuard(["ADMIN", "MODERATOR"], "FINANCE").statusCode, 403);
  assert.equal(evaluateGuard(["FAN"], "ARTIST").statusCode, 403);
  assert.equal(evaluateGuard(["ADMIN", "MODERATOR"], undefined).statusCode, 403);
}

function testAuthSourceContracts() {
  const requireAuth = source("common/auth/requireAuth.ts");
  const authService = source("modules/auth/auth.service.ts");
  const authController = source("modules/auth/auth.controller.ts");
  const authRoutes = source("modules/auth/auth.routes.ts");
  const adminIndex = source("routes/admin/index.ts");
  const adminAuth = source("routes/admin/auth.ts");
  const fanIndex = source("routes/fan/index.ts");
  const publicArtists = source("modules/artist/public-artist.routes.ts");
  const rootAuth = source("routes/auth.ts");
  const searchRoutes = source("routes/search.ts");
  const app = source("app.ts");
  const onboarding = source("modules/artist/artist-onboarding.routes.ts");
  const artistSecurity = source("modules/artist/artist-security.routes.ts");
  const userRoutes = source("modules/user/user.routes.ts");
  const passwordController = source("modules/user/password.controller.ts");
  const streamRoutes = source("modules/streaming/stream.routes.ts");
  const analyticsRoutes = source("modules/analytics/analytics.routes.ts");
  const authDbTest = source("scripts/test-auth-session-db.ts");
  const envValidation = source("config/env.validation.ts");
  const packageJson = source("../package.json");
  const fanApi = source("../../mobile/apps/fan/src/services/api.ts");
  const artistHttp = source("../../web-artist/src/services/http.ts");
  const adminHttp = source("../../web-admin/src/services/http.ts");
  const artistShell = source("../../web-artist/src/components/ArtistShell.tsx");
  const adminNavbar = source("../../web-admin/src/components/AdminNavbar.tsx");

  assert.equal(requireAuth.includes("Secret Prefix"), false, "JWT secret material must never be logged");
  assert.equal(requireAuth.includes("trust the token"), false, "No role may bypass authoritative DB state");
  assert.equal(requireAuth.includes("SessionService.assertActiveSession"), true, "Protected requests must validate server session state");
  assert.equal(requireAuth.includes("COALESCE(status, 'ACTIVE')"), false, "Account state must not fail open to ACTIVE");
  assert.equal(requireAuth.includes('export { requireRoles } from "./requireRoles"'), true, "RBAC must have one canonical implementation");
  assert.equal(requireAuth.includes("requireVerifiedArtist"), true, "Approved artist surfaces need a server-side verification guard");
  assert.equal(requireAuth.includes('artistStatus !== "APPROVED"'), true, "Verified artist gate must also require APPROVED artist state");

  assert.equal(authService.includes("42703"), false, "Auth must not retry against weaker schemas");
  assert.equal(authService.includes("Email not found"), false, "Login must not enumerate account existence");
  assert.equal(authService.includes("Incorrect password"), false, "Login must not expose credential mismatch type");
  assert.equal(authService.includes("FOR UPDATE"), true, "Credential verification must lock the user row before session creation");
  assert.equal(authService.includes("SessionService.createSessionInTransaction"), true, "Login must create the session inside the credential transaction");
  assert.equal(authService.includes('role !== "FAN" && role !== "ARTIST"'), true, "Shared login must reject privileged portal roles");
  assert.equal(authService.includes('artistStatus !== "APPROVED"'), true, "Artist login pending state must match the canonical approval gate");

  assert.equal(adminAuth.includes("This account cannot access the administration portal"), false, "Admin login must not reveal valid consumer credentials");
  assert.equal(adminAuth.includes("FOR UPDATE"), true, "Privileged login must lock the user row before session creation");
  assert.equal(adminAuth.includes("SessionService.createSessionInTransaction"), true, "Privileged session creation must share the login transaction");
  assert.equal(adminAuth.includes('router.post("/logout", requireAuth'), true, "Privileged logout must revoke the backend session");
  assert.equal(authController.includes("Unknown-ID"), false, "Unknown-ID must not be used as durable device identity");
  assert.equal(authRoutes.includes('router.get("/sessions"'), true, "Owned device sessions must be listable");
  assert.equal(authRoutes.includes('router.delete("/sessions/:sessionId"'), true, "Owned device sessions must be explicitly revocable");
  assert.equal(authRoutes.includes('router.post("/logout-all"'), true, "Logout-all must have backend semantics");

  assert.equal(adminIndex.includes("debug-audit"), false, "Admin debug endpoints must not be mounted");
  assert.equal(adminIndex.includes('requireRoles("ADMIN", "MODERATOR")'), true, "Content governance must preserve moderator boundary");
  assert.equal(fanIndex.includes('const requireFan = requireRoles("FAN")'), true, "Private fan domains must have an explicit FAN boundary");
  assert.equal(fanIndex.includes('modules/artist/public-artist.routes'), true, "Fan discovery must use the fail-closed artist router");
  assert.equal(fs.existsSync(path.join(srcRoot, "modules/artist/artist.routes.ts")), false, "Fail-open legacy public artist router must be removed");
  assert.equal(publicArtists.includes("is_verified = true"), true, "Fan artist discovery must require verified artists");
  assert.equal(publicArtists.includes("artist_status::text) = 'APPROVED'"), true, "Fan artist discovery must require approved artist state");
  assert.equal(publicArtists.includes("isVerified: true, // Default"), false, "Artist visibility must never default to verified");
  assert.equal(publicArtists.includes("Fallback if status or is_verified"), false, "Artist visibility must not retry with weaker schema assumptions");
  assert.equal(publicArtists.includes("process.env.NODE_ENV"), false, "Development mode must not bypass artist/content approval visibility");

  assert.equal(searchRoutes.includes('const requireFan = requireRoles("FAN")'), true, "Search history must be FAN-scoped");
  assert.equal(searchRoutes.includes("router.use(requireAuth, requireFan)"), true, "Search history must enforce auth and role centrally");
  assert.equal(streamRoutes.includes('const requireFan = requireRoles("FAN")'), true, "Playback control APIs must be FAN-scoped");
  assert.equal(analyticsRoutes.includes("getAdminDashboardMetrics"), false, "Admin analytics must never be exposed under the fan namespace");
  assert.equal(analyticsRoutes.includes('requireRoles("FAN")'), true, "Fan analytics ingestion must be FAN-scoped");

  assert.equal(userRoutes.includes("test-push"), false, "Production user router must not expose test push");
  assert.equal(userRoutes.includes("authLimiter, requireAuth, updatePasswordAndRotateSession"), true, "Password change must be rate-limited and session-aware");
  assert.equal(passwordController.includes("DELETE FROM user_sessions WHERE user_id = $1"), true, "Password change must revoke pre-change sessions");
  assert.equal(passwordController.includes("normalizeDeviceId"), true, "Password rotation must use canonical device validation");
  assert.equal(passwordController.includes("SessionService.createSessionInTransaction"), true, "Password replacement session must share the password transaction");
  assert.equal(passwordController.includes("FOR UPDATE"), true, "Password rotation must lock the user row before updating credentials");
  assert.equal(passwordController.includes("sessionRotated: true"), true, "Password change must return replacement-session contract");
  assert.equal(artistSecurity.includes("updatePasswordAndRotateSession"), true, "Artist password changes must use canonical session rotation");

  const secureOnboardingMount = app.indexOf('app.use("/api/v1/artist/onboard", artistOnboardingRoutes)');
  const legacyArtistMount = app.indexOf('app.use("/api/v1/artist", artistRoutes)');
  assert.ok(secureOnboardingMount >= 0 && legacyArtistMount > secureOnboardingMount, "Secure onboarding must intercept before the historical artist router");
  assert.equal(app.includes('"/api/v1/artist/dashboard"'), true, "Artist dashboard must be covered by the verified-artist gate");
  assert.equal(app.includes('"/api/v1/artist/pricing"'), true, "Artist pricing must be covered by the verified-artist gate");
  assert.equal(app.includes('"/api/v1/artist/analytics"'), true, "Artist analytics must be covered by the verified-artist gate");
  assert.equal(app.includes("requireVerifiedArtist"), true, "Artist business surfaces must enforce verification server-side");

  assert.equal(onboarding.includes("password = $"), false, "Artist onboarding continuation must never update an existing password");
  assert.equal(onboarding.includes("SessionService.createSessionInTransaction"), true, "New artist + first auth session must commit atomically");
  assert.equal(onboarding.includes("authenticatedId !== existingId"), true, "Existing-email onboarding must prove account ownership");
  assert.equal(onboarding.includes("SIGNATURE_ENCRYPTION_KEY ||"), true, "Onboarding signature encryption must be explicitly configured");

  assert.equal(rootAuth.includes("registerFan"), false, "Root auth must not retain the duplicate legacy registration controller");
  assert.equal(rootAuth.includes('router.post("/logout", requireAuth'), true, "Artist/shared logout must revoke the backend session");
  assert.equal(fs.existsSync(path.join(srcRoot, "controllers/auth.ts")), false, "Credential-logging legacy registration controller must be removed");

  assert.equal(envValidation.includes('envStr("JWT_SECRET")'), true, "JWT secret must fail fast at startup");
  assert.equal(envValidation.includes('envStr("SIGNATURE_ENCRYPTION_KEY")'), true, "Signature encryption key must fail fast at startup");
  assert.equal(envValidation.includes('envStr("MEDIA_SIGNED_TOKEN_SECRET")'), true, "Media signing secret must not use a static fallback");
  assert.equal(envValidation.includes("media-secret-change-me"), false, "Static media signing fallback is forbidden");

  assert.equal(packageJson.includes('"test:auth-db"'), true, "Disposable-DB auth integration suite must have a repeatable npm command");
  assert.equal(authDbTest.includes("auth-test-race-old-login"), true, "DB suite must cover old-password login racing password rotation");
  assert.equal(authDbTest.includes('tokenFor(userF, fSession.id, "ADMIN")'), true, "DB suite must prove JWT role claims cannot override DB role");
  assert.equal(authDbTest.includes("AUTH_TEST_DATABASE_URL"), true, "DB suite must require an explicit disposable database URL");

  assert.equal(fanApi.includes("X-Device-Id"), true, "Native fan client must send stable device identity");
  assert.equal(fanApi.includes("Platform.OS === 'web'"), true, "Fan web must use the browser-safe device contract");
  assert.equal(fanApi.includes("sessionRotated"), true, "Fan client must persist rotated JWTs");
  assert.equal(artistHttp.includes("deviceId: getOrCreateDeviceId()"), true, "Artist web auth must send stable device identity in request bodies");
  assert.equal(artistHttp.includes("sessionRotated"), true, "Artist web must persist rotated password-change sessions");
  assert.equal(adminHttp.includes("deviceId: getOrCreateDeviceId()"), true, "Admin web login must send stable device identity in the request body");
  assert.equal(artistShell.includes('/api/v1/auth/logout'), true, "Artist portal logout must revoke the server session before local cleanup");
  assert.equal(adminNavbar.includes('/api/v1/admin/logout'), true, "Admin portal logout must revoke the server session before local cleanup");
}

function main() {
  testRoleGuards();
  testAuthSourceContracts();
  console.log("Auth hardening contract checks passed.");
}

main();
