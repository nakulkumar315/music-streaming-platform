import assert from "assert";
import { resolveMediaIdentity } from "../shared/media/media-asset-locator";

function testCloudinaryUsesProviderAssetId() {
  const row = {
    storage_provider: "cloudinary",
    audio_provider_asset_id: "artists/2/media/19/track_audio_x1",
    video_provider_asset_id: "artists/2/media/19/track_video_x1",
    thumbnail_provider_asset_id: "artists/2/thumbnails/19/thumb_x1",
    storage_key: "artists/2/audio/2026/04/abcdef01.mp3",
    video_storage_key: "artists/2/video/2026/04/abcdef02.mp4",
    thumbnail_storage_key: "artists/2/thumbnails/2026/04/abcdef03.webp",
  };

  assert.equal(resolveMediaIdentity(row, "audio").providerAssetId, row.audio_provider_asset_id);
  assert.equal(resolveMediaIdentity(row, "video").providerAssetId, row.video_provider_asset_id);
  assert.equal(resolveMediaIdentity(row, "thumbnail").providerAssetId, row.thumbnail_provider_asset_id);
}

function testCloudinaryFallbackFromUrlsOnly() {
  const row = {
    storage_provider: "cloudinary",
    audio_url: "https://res.cloudinary.com/demo/video/authenticated/v1/artists/7/media/99/audio_track.mp3",
    thumbnail_url: "https://res.cloudinary.com/demo/image/upload/v1/artists/7/thumbnails/99/thumb.webp"
  };

  assert.equal(resolveMediaIdentity(row, "audio").providerAssetId, null);
  assert.equal(resolveMediaIdentity(row, "thumbnail").providerAssetId, null);
}

function testCloudinaryDoesNotTreatLocalKeyAsProviderId() {
  const row = {
    storage_provider: "cloudinary",
    storage_key: "artists/2/audio/2026/04/abcdef01.mp3",
  };

  assert.equal(resolveMediaIdentity(row, "audio").providerAssetId, null);
}

function testNonCloudinaryUsesInternalStorageKey() {
  const row = {
    storage_provider: "s3",
    storage_key: "artists/1/audio/2026/04/a1b2c3d4.mp3"
  };

  const resolved = resolveMediaIdentity(row, "audio");
  assert.equal(resolved.providerAssetId, null);
  assert.equal(resolved.internalStorageKey, row.storage_key);
}

function main() {
  testCloudinaryUsesProviderAssetId();
  testCloudinaryFallbackFromUrlsOnly();
  testCloudinaryDoesNotTreatLocalKeyAsProviderId();
  testNonCloudinaryUsesInternalStorageKey();
  console.log("[test-cloudinary-identity-resolution] all assertions passed");
}

main();

