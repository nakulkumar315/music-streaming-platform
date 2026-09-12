import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve(__dirname, "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function main() {
  const adminIndex = source("routes/admin/index.ts");
  const accountRouter = source("routes/admin/account-security.ts");
  const accountService = source("common/auth/account-state.service.ts");
  const accountDbTest = source("scripts/test-account-state-db.ts");

  const securityMount = adminIndex.indexOf('router.use("/", adminAccountSecurityRoutes)');
  const artistMount = adminIndex.indexOf('router.use("/artists", requireAuth, requireRoles("ADMIN"), adminArtistsRoutes)');
  const contentMount = adminIndex.indexOf('"/content",\n  requireAuth,\n  requireRoles("ADMIN", "MODERATOR"),\n  adminContentRoutes');

  assert.ok(securityMount >= 0, "Canonical admin account-security router must be mounted");
  assert.ok(artistMount > securityMount, "Account-security routes must intercept before the historical artist router");
  assert.ok(contentMount > securityMount, "Account-security routes must intercept before the historical moderation router");

  assert.equal(accountRouter.includes("router.use(requireAuth"), false, "Root-mounted account security must not globally block unrelated MODERATOR routes");
  assert.equal(accountRouter.includes('const requireAdmin = requireRoles("ADMIN")'), true, "Account-state mutations must retain an ADMIN guard");
  assert.equal(accountRouter.includes('router.patch("/artists/:id/soft-delete", requireAuth, requireAdmin'), true);
  assert.equal(accountRouter.includes('router.patch("/artists/:id/reactivate", requireAuth, requireAdmin'), true);
  assert.equal(accountRouter.includes('router.patch("/artists/:id/status", requireAuth, requireAdmin'), true);
  assert.equal(accountRouter.includes('router.post("/content/artists/:artistId/ban", requireAuth, requireAdmin'), true);
  assert.equal(accountRouter.includes("reauthenticationRequired: true"), true, "Explicit reactivation must require fresh authentication");

  assert.equal(accountService.includes("FOR UPDATE"), true, "Privileged account mutations must lock the user row");
  assert.equal(accountService.includes("DELETE FROM user_sessions WHERE user_id = $1 RETURNING id"), true, "Account state mutations must revoke server sessions transactionally");
  assert.equal(accountService.includes("status = 'SUSPENDED'"), true, "Deactivate/status toggle must use canonical SUSPENDED state");
  assert.equal(accountService.includes("status = 'BANNED'"), true, "Ban must use canonical BANNED state");
  assert.equal(accountService.includes("never revives a previously issued JWT"), true, "Reactivation must explicitly preserve revocation semantics");

  assert.equal(accountDbTest.includes("Soft delete must revoke every active artist session"), true);
  assert.equal(accountDbTest.includes("Activation must not revive pre-suspension sessions"), true);
  assert.equal(accountDbTest.includes("Ban must revoke the active artist session"), true);
  assert.equal(accountDbTest.includes("No session may survive delete/login race"), true, "DB evidence must cover concurrent login vs account deletion");
  assert.equal(accountDbTest.includes("AUTH_TEST_DATABASE_URL"), true, "DB evidence must require a disposable database");

  console.log("Artist account-state security contract checks passed.");
}

main();
