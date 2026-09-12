import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve(__dirname, "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function main() {
  const app = source("app.ts");
  const artistRoutes = source("routes/artist.ts");
  const contentRoutes = source("routes/content.ts");
  const analyticsController = source("controllers/analyticsController.ts");
  const onboarding = source("modules/artist/artist-onboarding.routes.ts");
  const artistSecurity = source("modules/artist/artist-security.routes.ts");

  const secureOnboardingMount = app.indexOf('app.use("/api/v1/artist/onboard", artistOnboardingRoutes)');
  const securePasswordMount = app.indexOf('app.use("/api/v1/artist/update-password", artistSecurityRoutes)');
  const legacyArtistMount = app.indexOf('app.use("/api/v1/artist", artistRoutes)');

  assert.ok(secureOnboardingMount >= 0 && secureOnboardingMount < legacyArtistMount, "Canonical onboarding must intercept the historical artist router");
  assert.ok(securePasswordMount >= 0 && securePasswordMount < legacyArtistMount, "Canonical password rotation must intercept the historical artist router");
  assert.equal(onboarding.includes("authenticatedId !== existingId"), true, "Existing-email onboarding must prove current-account ownership");
  assert.equal(artistSecurity.includes("updatePasswordAndRotateSession"), true, "Artist password change must use canonical session rotation");

  assert.equal(artistRoutes.includes("req.params"), false, "Artist account/dashboard router must not select another artist by route parameter");
  assert.equal(artistRoutes.includes("const artistUserId = req.user?.id"), true, "Artist account/dashboard queries must derive artist identity from authenticated user");
  assert.equal(analyticsController.includes("const artistId = (req as any).user?.id"), true, "Artist subscription insights must derive ownership from authentication");
  assert.equal(analyticsController.includes("getArtistInsights(artistId)"), true);

  assert.equal(contentRoutes.includes('router.get("/mine", requireAuth, requireArtist'), true, "Artist content listing must require artist authentication");
  assert.equal(contentRoutes.includes("const artistId = req.user?.id"), true, "Artist content listing/history must derive artist id from authenticated user");
  assert.equal(contentRoutes.includes("WHERE id = $1 AND artist_id = $2"), true, "Artist content deletion must bind content id to authenticated artist ownership");
  assert.equal(contentRoutes.includes("[id, actorId]"), true, "Artist delete ownership predicate must use authenticated actor id");
  assert.equal(contentRoutes.includes('role === "ADMIN"'), true, "Administrative content deletion must remain an explicit separate branch");

  assert.equal(app.includes('"/api/v1/artist/dashboard"'), true, "Artist dashboard business routes must retain server-side approval gating");
  assert.equal(app.includes('"/api/v1/artist/uploads"'), true, "Artist upload business routes must retain server-side approval gating");

  console.log("Artist ownership/IDOR contract checks passed.");
}

main();
