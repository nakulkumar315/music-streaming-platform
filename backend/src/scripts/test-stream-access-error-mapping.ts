import assert from "node:assert/strict";
import { mapStreamAccessError } from "../modules/streaming/stream-access-error";
import {
  MediaAccessDeniedException,
  MediaExpiredAccessException,
  MediaInvalidTokenException,
  MediaNotReadyException,
} from "../shared/exceptions/media.exception";
import { DeliveryFailedException } from "../shared/exceptions/delivery.exception";

function testMediaNotReadyMapsTo409() {
  const result = mapStreamAccessError(new MediaNotReadyException(42, "PROCESSING"));
  assert.equal(result.status, 409);
  assert.equal(result.code, "CONTENT_NOT_READY");
}

function testTakedownMapsTo410() {
  const result = mapStreamAccessError(new MediaNotReadyException(42, "TAKEN_DOWN"));
  assert.equal(result.status, 410);
  assert.equal(result.code, "CONTENT_TAKEN_DOWN");
}

function testTypedEntitlementDenialsArePreserved() {
  const required = mapStreamAccessError(
    new MediaAccessDeniedException("Subscription required", "SUBSCRIPTION_REQUIRED")
  );
  assert.equal(required.status, 403);
  assert.equal(required.code, "SUBSCRIPTION_REQUIRED");

  const expired = mapStreamAccessError(
    new MediaAccessDeniedException("Subscription expired", "SUBSCRIPTION_EXPIRED")
  );
  assert.equal(expired.status, 403);
  assert.equal(expired.code, "SUBSCRIPTION_EXPIRED");

  const limit = mapStreamAccessError(
    new MediaAccessDeniedException("Too many streams", "PLAYBACK_SESSION_LIMIT")
  );
  assert.equal(limit.status, 403);
  assert.equal(limit.code, "PLAYBACK_SESSION_LIMIT");
}

function testPlaybackCredentialFailuresAreTyped() {
  const expired = mapStreamAccessError(new MediaExpiredAccessException());
  assert.equal(expired.status, 401);
  assert.equal(expired.code, "PLAYBACK_ACCESS_EXPIRED");

  const invalid = mapStreamAccessError(new MediaInvalidTokenException());
  assert.equal(invalid.status, 401);
  assert.equal(invalid.code, "INVALID_PLAYBACK_TOKEN");
}

function testDeliveryFailureMapsTo502() {
  const result = mapStreamAccessError(new DeliveryFailedException("Firebase provider misconfigured"));
  assert.equal(result.status, 502);
  assert.equal(result.code, "PLAYBACK_URL_GENERATION_FAILED");
}

function testUnknownMapsTo500() {
  const result = mapStreamAccessError(new Error("unknown"));
  assert.equal(result.status, 500);
  assert.equal(result.code, "INTERNAL_ERROR");
}

function run() {
  testMediaNotReadyMapsTo409();
  testTakedownMapsTo410();
  testTypedEntitlementDenialsArePreserved();
  testPlaybackCredentialFailuresAreTyped();
  testDeliveryFailureMapsTo502();
  testUnknownMapsTo500();
  console.log("test-stream-access-error-mapping: all assertions passed");
}

run();

