import crypto from "crypto";
import { validateEnv } from "../../config/env.validation";

export class CloudinaryWebhookAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CloudinaryWebhookAuthError";
  }
}

function safeHexEqual(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function digest(algorithm: "sha1" | "sha256", rawBody: Buffer, timestamp: string, secret: string) {
  return crypto
    .createHash(algorithm)
    .update(rawBody)
    .update(timestamp)
    .update(secret)
    .digest("hex");
}

export function verifyCloudinaryWebhook(input: {
  rawBody: Buffer;
  signature: unknown;
  timestamp: unknown;
  nowSeconds?: number;
}) {
  const signature = String(input.signature || "").trim().toLowerCase();
  const timestamp = String(input.timestamp || "").trim();
  const runtime = validateEnv();
  const secret = runtime.cloudinaryApiSecret;

  if (!secret) {
    throw new CloudinaryWebhookAuthError(
      "CLOUDINARY_WEBHOOK_NOT_CONFIGURED",
      "Cloudinary webhook verification is not configured"
    );
  }
  if (!signature || !timestamp) {
    throw new CloudinaryWebhookAuthError(
      "CLOUDINARY_WEBHOOK_SIGNATURE_REQUIRED",
      "Cloudinary signature and timestamp headers are required"
    );
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new CloudinaryWebhookAuthError(
      "CLOUDINARY_WEBHOOK_TIMESTAMP_INVALID",
      "Cloudinary timestamp is invalid"
    );
  }

  const maxAgeSeconds = runtime.cloudinaryWebhookMaxAgeSeconds;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSeconds - timestampSeconds);
  if (age > maxAgeSeconds) {
    throw new CloudinaryWebhookAuthError(
      "CLOUDINARY_WEBHOOK_STALE",
      "Cloudinary webhook timestamp is outside the allowed replay window"
    );
  }

  const expectedSha1 = digest("sha1", input.rawBody, timestamp, secret);
  const expectedSha256 = digest("sha256", input.rawBody, timestamp, secret);
  if (!safeHexEqual(signature, expectedSha1) && !safeHexEqual(signature, expectedSha256)) {
    throw new CloudinaryWebhookAuthError(
      "CLOUDINARY_WEBHOOK_SIGNATURE_INVALID",
      "Cloudinary webhook signature is invalid"
    );
  }

  return { timestampSeconds, maxAgeSeconds };
}

export function deriveCloudinaryEventId(rawBody: Buffer, timestamp: string, signature: string) {
  return crypto
    .createHash("sha256")
    .update("cloudinary:")
    .update(timestamp)
    .update(":")
    .update(signature)
    .update(":")
    .update(rawBody)
    .digest("hex");
}
