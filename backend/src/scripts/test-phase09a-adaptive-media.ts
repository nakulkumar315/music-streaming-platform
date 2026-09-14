import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  cloudinaryEagerTransformsForSourceHeight,
  qualitiesForSourceHeight,
} from "../modules/media/adaptive-renditions";

const SRC = path.resolve(__dirname, "..");
const BACKEND = path.resolve(SRC, "..");
const REPO = path.resolve(BACKEND, "..");

const readBackend = (relativePath: string) =>
  fs.readFileSync(path.join(SRC, relativePath), "utf8");
const readRepo = (relativePath: string) =>
  fs.readFileSync(path.join(REPO, relativePath), "utf8");

function testSourceAwareRenditionLadder() {
  assert.deepEqual(qualitiesForSourceHeight(480), ["144p", "240p", "360p", "480p"]);
  assert.deepEqual(qualitiesForSourceHeight(720), [
    "144p",
    "240p",
    "360p",
    "480p",
    "720p",
  ]);
  assert.deepEqual(qualitiesForSourceHeight(1080), [
    "144p",
    "240p",
    "360p",
    "480p",
    "720p",
    "1080p",
  ]);
  assert.deepEqual(qualitiesForSourceHeight(120), []);

  const transforms = cloudinaryEagerTransformsForSourceHeight(480) as any[];
  assert.equal(transforms.length, 5);
  for (const rendition of transforms.slice(0, -1)) {
    assert.equal(rendition.crop, "limit", "manual adaptive renditions must never upscale");
    assert.equal(rendition.format, "m3u8");
    assert.ok(Number(rendition.height) <= 480);
  }
  assert.deepEqual(transforms[transforms.length - 1], {
    streaming_profile: "auto",
    format: "m3u8",
  });
}

function testMigrationAndSchemaGate() {
  const migration = readRepo("backend/db/migrations/20260914_0012_adaptive_protected_media.sql");
  const schema = readBackend("common/db/schema-readiness.ts");

  for (const field of [
    "adaptive_status",
    "adaptive_qualities",
    "source_width",
    "source_height",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`));
    assert.match(schema, new RegExp(`\"${field}\"`));
  }

  assert.match(migration, /adaptive_status = 'PENDING'/);
  assert.match(migration, /LOWER\(storage_provider\) = 'cloudinary'/);
  assert.match(migration, /content_items_adaptive_status_valid/);
  assert.match(migration, /content_items_adaptive_qualities_valid/);
  assert.match(migration, /idx_content_items_adaptive_readiness/);
  assert.match(
    schema,
    /LATEST_SCHEMA_VERSION = "20260914_0012_adaptive_protected_media"/
  );
}

function testPlaybackDescriptorAndQualityAuthority() {
  const access = readBackend("modules/media/media-access.service.ts");
  const authz = readBackend("shared/security/media-authz.service.ts");
  const stream = readBackend("modules/streaming/stream.routes.ts");
  const subscription = readBackend("modules/subscription/sub.routes.ts");

  assert.match(access, /adaptiveStatus !== "READY"/);
  assert.match(access, /actualAdaptiveQualities\(content\.adaptive_qualities\)/);
  assert.match(access, /MediaInvalidQualityException/);
  assert.match(access, /playbackMode = "HLS"/);
  assert.match(access, /expiresInSeconds = config\.mediaUrlTtlSeconds/);
  assert.match(access, /expiresAt:/);
  assert.match(access, /qualities,/);
  assert.match(access, /selectedQuality/);
  assert.match(access, /defaultQuality/);

  assert.match(authz, /throw new MediaInvalidQualityException/);
  assert.doesNotMatch(
    authz,
    /requestedQuality[\s\S]{0,400}\?\?\s*"Auto"/,
    "Unknown quality input must not silently downgrade to Auto"
  );

  assert.match(stream, /Cache-Control", "private, no-store, max-age=0"/);
  assert.match(stream, /playbackMode: result\.playbackMode/);
  assert.match(stream, /expiresAt: result\.expiresAt/);
  assert.match(stream, /qualities: result\.qualities/);

  // The legacy mobile endpoint must not turn an undocumented subscription tier
  // into playback authority. It exists only to keep the old player on Auto/ABR;
  // content-specific qualities are still returned by /stream/access.
  assert.match(subscription, /router\.get\("\/quality"/);
  assert.match(subscription, /policy: "SOURCE_AVAILABLE"/);
  assert.match(subscription, /Actual[\s\S]{0,120}content-specific qualities[\s\S]{0,120}\/stream\/access/);
}

function testAdaptiveHlsSecurityBoundary() {
  const routes = readBackend("modules/media/adaptive-media-stream.routes.ts");
  const proxy = readBackend("modules/media/hls-proxy.service.ts");
  const token = readBackend("shared/security/hls-resource-token.service.ts");
  const app = readBackend("app.ts");

  assert.match(routes, /isPlaybackSessionActive/);
  assert.match(routes, /checkMediaEntitlement/);
  assert.match(routes, /verifyHlsResourceToken/);
  assert.match(routes, /adaptive_status/);
  assert.match(routes, /private, no-store, max-age=0/);
  assert.match(routes, /remainingSeconds = payload\.exp/);

  assert.match(proxy, /hostname\.toLowerCase\(\) === "res\.cloudinary\.com"/);
  assert.match(proxy, /redirect: "manual"/);
  assert.match(proxy, /Adaptive upstream redirect is not allowed/);
  assert.match(proxy, /MANIFEST_MAX_BYTES/);
  assert.match(proxy, /UPSTREAM_TIMEOUT_MS/);
  assert.match(proxy, /createHlsResourceToken/);
  assert.match(proxy, /private, no-store, max-age=0/);
  assert.doesNotMatch(proxy, /res\.redirect|\.redirect\(/);

  assert.match(token, /aes-256-gcm/);
  assert.match(token, /mediaId/);
  assert.match(token, /userId/);
  assert.match(token, /sessionId/);
  assert.match(token, /upstreamUrl/);
  assert.match(token, /exp/);

  const adaptiveMount = app.indexOf('app.use("/media/stream", adaptiveMediaStreamRoutes)');
  const progressiveMount = app.indexOf('app.use("/media/stream", mediaStreamRoutes)');
  assert.ok(adaptiveMount >= 0 && progressiveMount > adaptiveMount);
}

function testUploadWebhookAndBackfillReadiness() {
  const upload = readBackend("controllers/admin/adminMediaController.ts");
  const webhook = readBackend("controllers/media/WebhookController.ts");
  const provider = readBackend("shared/storage/providers/cloudinary-storage.provider.ts");
  const backfill = readBackend("scripts/backfill-adaptive-video.ts");

  assert.match(upload, /source_width/);
  assert.match(upload, /source_height/);
  assert.match(upload, /adaptive_qualities/);
  assert.match(upload, /adaptive_status/);
  assert.match(upload, /adaptiveQualities/);

  assert.match(provider, /cloudinaryEagerTransformsForSourceHeight/);
  assert.match(provider, /qualitiesForSourceHeight/);
  assert.match(provider, /eager_async: true/);
  assert.match(provider, /eager_notification_url/);

  assert.match(webhook, /adaptive_status/);
  assert.match(webhook, /adaptive_qualities/);
  assert.match(webhook, /successfulHlsResultCount/);
  assert.match(webhook, /hasSuccessfulAutoHlsResult/);
  assert.match(webhook, /adaptiveEvidenceComplete/);
  assert.match(webhook, /adaptiveOutcome = isVideo/);
  assert.match(webhook, /adaptiveEvidenceComplete[\s\S]{0,120}\? "READY"[\s\S]{0,120}: "FAILED"/);

  assert.match(backfill, /pg_try_advisory_lock/);
  assert.match(backfill, /adaptive_status = 'PENDING'/);
  assert.match(backfill, /cloudinary\.api\.resource/);
  assert.match(backfill, /source_width/);
  assert.match(backfill, /source_height/);
  assert.match(backfill, /cloudinary\.uploader\.explicit/);
  assert.match(backfill, /eager_async: true/);
  assert.match(backfill, /content\.adaptive_backfill_scheduled/);
}

function testMobileAndCatalogFailClosedContract() {
  const streamService = readRepo("mobile/apps/fan/src/services/streamService.ts");
  const catalog = readBackend("modules/content/content.routes.ts");

  assert.match(streamService, /getPlaybackDescriptor/);
  assert.match(streamService, /playbackMode/);
  assert.match(streamService, /expiresAt/);
  assert.match(streamService, /qualities/);
  assert.match(streamService, /if \(kind === 'video'\) return false/);
  assert.doesNotMatch(
    streamService,
    /kind === 'video'[\s\S]{0,200}endsWith\('\.mp4'\)/,
    "Protected video validator must not accept raw progressive provider URLs"
  );

  assert.match(catalog, /mediaUrl: null/);
  assert.match(catalog, /fileUrl: null/);
  assert.match(catalog, /audioUrl: null/);
  assert.match(catalog, /videoUrl: null/);
  assert.match(catalog, /playbackEndpoint: "\/api\/v1\/fan\/stream\/access"/);
}

function run() {
  testSourceAwareRenditionLadder();
  testMigrationAndSchemaGate();
  testPlaybackDescriptorAndQualityAuthority();
  testAdaptiveHlsSecurityBoundary();
  testUploadWebhookAndBackfillReadiness();
  testMobileAndCatalogFailClosedContract();
  console.log("Phase 09A adaptive protected-media contract checks passed.");
}

run();
