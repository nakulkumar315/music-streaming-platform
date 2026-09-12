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
  assert.equal(evaluateGuard(["ADMIN", "MODERATOR"], undefined).statusCode, 403);
}

function testAuthSourceContracts() {
  const requireAuth = source("common/auth/requireAuth.ts");
  const authService = source("modules/auth/auth.service.ts");
  const authController = source("modules/auth/auth.controller.ts");
  const adminIndex = source("routes/admin/index.ts");
  const userRoutes = source("modules/user/user.routes.ts");
  const passwordController = source("modules/user/password.controller.ts");
  const fanApi = source("../../mobile/apps/fan/src/services/api.ts");
  const artistHttp = source("../../web-artist/src/services/http.ts");
  const adminHttp = source("../../web-admin/src/services/http.ts");

  assert.equal(requireAuth.includes("Secret Prefix"), false, "JWT secret material must never be logged");
  assert.equal(requireAuth.includes("trust the token"), false, "No role may bypass authoritative DB state");
  assert.equal(requireAuth.includes("SessionService.assertActiveSession"), true, "Protected requests must validate server session state");
  assert.equal(requireAuth.includes("COALESCE(status, 'ACTIVE')"), false, "Account state must not fail open to ACTIVE");

  assert.equal(authService.includes("42703"), false, "Auth must not retry against weaker schemas");
  assert.equal(authService.includes("Email not found"), false, "Login must not enumerate account existence");
  assert.equal(authService.includes("Incorrect password"), false, "Login must not expose credential mismatch type");
  assert.equal(authService.includes("SessionService.createSession"), true, "Login must create authoritative server sessions");

  assert.equal(authController.includes("Unknown-ID"), false, "Unknown-ID must not be used as durable device identity");
  assert.equal(adminIndex.includes("debug-audit"), false, "Admin debug endpoints must not be mounted");
  assert.equal(adminIndex.includes('requireRoles("ADMIN", "MODERATOR")'), true, "Content governance must preserve moderator boundary");
  assert.equal(userRoutes.includes("test-push"), false, "Production user router must not expose test push");
  assert.equal(userRoutes.includes("authLimiter, requireAuth, updatePasswordAndRotateSession"), true, "Password change must be rate-limited and session-aware");

  assert.equal(passwordController.includes("DELETE FROM user_sessions WHERE user_id = $1"), true, "Password change must revoke pre-change sessions");
  assert.equal(passwordController.includes("sessionRotated: true"), true, "Password change must return replacement-session contract");

  assert.equal(fanApi.includes("X-Device-Id"), true, "Fan client must send stable device identity");
  assert.equal(fanApi.includes("sessionRotated"), true, "Fan client must persist rotated JWTs");
  assert.equal(artistHttp.includes("X-Device-Id"), true, "Artist web must send stable device identity");
  assert.equal(adminHttp.includes("X-Device-Id"), true, "Admin web must send stable device identity");
}

function main() {
  testRoleGuards();
  testAuthSourceContracts();
  console.log("Auth hardening contract checks passed.");
}

main();
