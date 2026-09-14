import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validatePhase1ReleaseMetadata } from "../modules/distribution/release-domain.validation";

const SRC = path.resolve(__dirname, "..");
const BACKEND = path.resolve(SRC, "..");
const REPO = path.resolve(BACKEND, "..");
const readBackend = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");
const readRepo = (relativePath: string) =>
  fs.readFileSync(path.join(REPO, relativePath), "utf8");

function expectValidationError(work: () => unknown, code: string) {
  assert.throws(work, (error: any) => error?.code === code);
}

function testReleaseMetadataValidation() {
  const defaults = validatePhase1ReleaseMetadata({}, "AUDIO");
  assert.ok(defaults);
  assert.equal(defaults?.releaseType, "SINGLE");
  assert.equal(defaults?.isrc, null);
  assert.equal(defaults?.upcEan, null);
  assert.deepEqual(defaults?.contributors, []);

  const valid = validatePhase1ReleaseMetadata(
    {
      releaseType: "single",
      language: "Hindi",
      explicit: "true",
      labelName: "Independent",
      earlyAccessStartAt: "2026-10-01T00:00:00Z",
      publicReleaseAt: "2026-10-08T00:00:00Z",
      exclusivityEndAt: "2026-10-08T00:00:00Z",
      upcEan: "123456789012",
      isrc: "IN-ABC-26-12345",
      contributors: JSON.stringify([
        { displayName: "Guest Artist", role: "FEATURED_ARTIST" },
        { displayName: "Producer Name", role: "PRODUCER" },
      ]),
    },
    "AUDIO"
  );
  assert.equal(valid?.releaseType, "SINGLE");
  assert.equal(valid?.upcEan, "123456789012");
  assert.equal(valid?.isrc, "INABC2612345");
  assert.equal(valid?.explicit, true);
  assert.equal(valid?.contributors.length, 2);

  expectValidationError(
    () => validatePhase1ReleaseMetadata({ releaseType: "MIXTAPE" }, "AUDIO"),
    "INVALID_RELEASE_TYPE"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ releaseType: "EP" }, "AUDIO"),
    "MULTI_TRACK_RELEASE_REQUIRES_RELEASE_API"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ releaseType: "ALBUM" }, "AUDIO"),
    "MULTI_TRACK_RELEASE_REQUIRES_RELEASE_API"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ isrc: "FAKE-ISRC" }, "AUDIO"),
    "INVALID_ISRC"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ upcEan: "12345" }, "AUDIO"),
    "INVALID_UPC_EAN"
  );
  expectValidationError(
    () =>
      validatePhase1ReleaseMetadata(
        {
          earlyAccessStartAt: "2026-10-08T00:00:00Z",
          publicReleaseAt: "2026-10-01T00:00:00Z",
        },
        "AUDIO"
      ),
    "INVALID_RELEASE_DATES"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ releaseType: "SINGLE" }, "VIDEO"),
    "RELEASE_METADATA_AUDIO_ONLY"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ distributionStatus: "DISTRIBUTED" }, "AUDIO"),
    "DISTRIBUTION_WORKFLOW_NOT_AVAILABLE"
  );
  expectValidationError(
    () => validatePhase1ReleaseMetadata({ providerCode: "spotify" }, "AUDIO"),
    "DISTRIBUTION_WORKFLOW_NOT_AVAILABLE"
  );
  expectValidationError(
    () =>
      validatePhase1ReleaseMetadata(
        { contributors: [{ displayName: "Person", role: "UNKNOWN_ROLE" }] },
        "AUDIO"
      ),
    "INVALID_RELEASE_METADATA"
  );
}

function testMigrationAndBackfillContract() {
  const migration = readRepo(
    "backend/db/migrations/20260914_0011_distribution_ready_domain.sql"
  );
  const schema = readBackend("common/db/schema-readiness.ts");

  for (const table of [
    "releases",
    "release_tracks",
    "release_contributors",
    "external_platform_links",
    "distribution_submissions",
    "distribution_platform_statuses",
    "distribution_outbox",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(`${table}: \\[`));
  }

  assert.match(schema, /LATEST_SCHEMA_VERSION = "20260914_0011_distribution_ready_domain"/);
  assert.match(schema, /"release_track_id"/);
  assert.match(schema, /releases_distribution_status_valid/);
  assert.match(schema, /distribution_submissions_idempotency_unique/);
  assert.match(schema, /idx_distribution_outbox_pending/);

  assert.match(migration, /WHERE UPPER\(c\.type\) = 'AUDIO'/);
  assert.match(migration, /'SINGLE'/);
  assert.match(migration, /'NOT_SUBMITTED'/);
  assert.match(migration, /ON CONFLICT \(source_content_id\) DO NOTHING/);
  assert.match(migration, /ON CONFLICT \(content_item_id\) DO NOTHING/);
  assert.match(migration, /SET release_track_id = rt\.id/);
  assert.doesNotMatch(
    migration,
    /SELECT[\s\S]*?'DISTRIBUTED'[\s\S]*?FROM content_items/i,
    "Legacy content backfill must never mark releases as distributed"
  );
  assert.doesNotMatch(migration, /generate.*(?:isrc|upc)|random.*(?:isrc|upc)/i);
}

function testCompatibilityAndProviderBoundary() {
  const compatibility = readBackend(
    "modules/distribution/release-compatibility.service.ts"
  );
  const provider = readBackend("modules/distribution/distributor-provider.ts");
  const upload = readBackend("controllers/admin/adminMediaController.ts");
  const fanContent = readBackend("modules/content/content.routes.ts");

  assert.match(compatibility, /ensureSingleReleaseForAudioContent/);
  assert.match(compatibility, /distribution_status[\s\S]*'NOT_SUBMITTED'/);
  assert.match(compatibility, /content_item_id/);
  assert.match(compatibility, /release_track_id/);
  assert.doesNotMatch(compatibility, /fetch\(|axios|spotify|apple|amazon|distrokid|tunecore/i);

  assert.match(provider, /export interface DistributorProvider/);
  assert.match(provider, /validateRelease/);
  assert.match(provider, /submitRelease/);
  assert.match(provider, /getSubmissionStatus/);
  assert.match(provider, /requestTakedown/);
  assert.doesNotMatch(provider, /from ["'](?:axios|node-fetch|https?|@aws-sdk)/i);
  assert.doesNotMatch(provider, /https?:\/\//i);

  assert.match(upload, /validatePhase1ReleaseMetadata/);
  assert.match(upload, /metadata\.contentType === "AUDIO" && releaseMetadata/);
  assert.match(upload, /ensureSingleReleaseForAudioContent/);
  assert.match(upload, /distributionStatus: "NOT_SUBMITTED"/);

  // Current fan identity remains content_items.id; release IDs are additive and
  // must not replace browse/playback identifiers during Phase 09.
  assert.match(fanContent, /id: Number\(row\.id\)/);
  assert.match(fanContent, /playbackEndpoint: "\/api\/v1\/fan\/stream\/access"/);
  assert.doesNotMatch(fanContent, /release_track_id|releaseId|release_id/);
}

function run() {
  testReleaseMetadataValidation();
  testMigrationAndBackfillContract();
  testCompatibilityAndProviderBoundary();
  console.log("Phase 09 distribution-ready domain checks passed.");
}

run();
