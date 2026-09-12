import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve(__dirname, "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

function main() {
  const route = source("routes/admin/artist-approvals.ts");
  const service = source("modules/artist/artist-approval.service.ts");

  assert.equal(route.includes('const requireAdmin = requireRoles("ADMIN")'), true, "Artist approval must remain ADMIN-only");
  assert.equal(route.includes("ArtistApprovalService.resolve"), true, "Sensitive artist approval decisions must go through the business service");
  assert.equal(route.includes("UPDATE users\n         SET artist_status"), false, "Approval SQL must not move back into the admin route");
  assert.equal(route.includes("invalidateArtistCache()"), true, "Approval changes must invalidate public artist visibility caches");
  assert.equal(route.includes("admin.artist_approved"), true, "Approval must emit an audit event");
  assert.equal(route.includes("admin.artist_rejected"), true, "Rejection must emit an audit event");
  assert.equal(route.includes("req.body"), true, "Route may parse request input but must not log the raw request body");
  assert.equal(route.includes("body: req.body"), false, "Raw approval request bodies must not be logged");

  assert.equal(service.includes("FOR UPDATE"), true, "Approval service must serialize decisions on the artist row");
  assert.equal(service.includes("BEGIN"), true);
  assert.equal(service.includes("COMMIT"), true);
  assert.equal(service.includes("ROLLBACK"), true);
  assert.equal(service.includes("ARTIST_ACCOUNT_INACTIVE"), true, "Inactive/deleted accounts must not be approved or rejected");
  assert.equal(service.includes("artist_status = 'APPROVED'"), true);
  assert.equal(service.includes("is_verified = true"), true);
  assert.equal(service.includes("artist_status = 'REJECTED'"), true);
  assert.equal(service.includes("is_verified = false"), true);
  assert.equal(service.includes("REJECTION_REASON_REQUIRED"), true, "Rejection must require an explicit reason");

  console.log("Artist approval governance contract checks passed.");
}

main();
