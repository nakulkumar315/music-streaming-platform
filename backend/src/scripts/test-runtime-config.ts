import assert from "node:assert/strict";
import { resetEnvCache, validateEnv } from "../config/env.validation";

const original = { ...process.env };

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  Object.assign(process.env, original);
  resetEnvCache();
}

function apply(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

function productionBaseline(): Record<string, string> {
  return {
    NODE_ENV: "production",
    PORT: "8000",
    DATABASE_URL: "postgresql://app:password@db.example.internal:5432/music",
    JWT_SECRET: "jwt-0123456789abcdef-0123456789abcdef",
    SIGNATURE_ENCRYPTION_KEY: "signature-0123456789abcdef-0123456789abcdef",
    MEDIA_SIGNED_TOKEN_SECRET: "media-0123456789abcdef-0123456789abcdef",
    STORAGE_PROVIDER: "s3",
    APP_BASE_URL: "https://api.music.example.com",
    CORS_ALLOWED_ORIGINS: "https://admin.music.example.com,https://artist.music.example.com",
    TRUST_PROXY_HOPS: "1",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "aws-secret-value",
    AWS_REGION: "ap-south-1",
    AWS_S3_BUCKET: "music-media",
    MEDIA_URL_TTL_SECONDS: "300",
    MAX_UPLOAD_AUDIO_MB: "50",
    MAX_UPLOAD_VIDEO_MB: "500",
    MAX_UPLOAD_IMAGE_MB: "10",
    SUBSCRIPTION_ENABLED: "false",
    REDIS_URL: "rediss://:cache-password@cache.example.internal:6379",
    SENTRY_DSN: "https://public-key@sentry.example.com/123",
  };
}

function expectFailure(
  name: string,
  overrides: Record<string, string | undefined>,
  expectedText: string
) {
  restoreEnvironment();
  apply(productionBaseline());
  apply(overrides);
  assert.throws(
    () => validateEnv(),
    (error: unknown) => error instanceof Error && error.message.includes(expectedText),
    name
  );
}

function main() {
  restoreEnvironment();
  apply({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/music_test",
    JWT_SECRET: "dev-jwt",
    SIGNATURE_ENCRYPTION_KEY: "dev-signature",
    MEDIA_SIGNED_TOKEN_SECRET: "dev-media",
    STORAGE_PROVIDER: "local",
    APP_BASE_URL: "http://localhost:8000",
    SUBSCRIPTION_ENABLED: "false",
  });
  assert.equal(validateEnv().storageProvider, "local", "Explicit local test configuration must remain supported");

  restoreEnvironment();
  apply(productionBaseline());
  const valid = validateEnv();
  assert.equal(valid.appBaseUrl, "https://api.music.example.com");
  assert.equal(valid.trustProxyHops, 1);
  assert.match(valid.redisUrl || "", /^rediss:/);
  assert.match(valid.sentryDsn || "", /^https:\/\/public-key@/);

  expectFailure("production requires APP_BASE_URL", { APP_BASE_URL: undefined }, "APP_BASE_URL");
  expectFailure("production rejects localhost public URL", { APP_BASE_URL: "https://localhost:8000" }, "localhost");
  expectFailure("production rejects local storage", { STORAGE_PROVIDER: "local" }, "development/test only");
  expectFailure("production rejects placeholder JWT", { JWT_SECRET: "replace-me-with-a-secret-value-1234567890" }, "placeholder");
  expectFailure("unsupported provider fails", { STORAGE_PROVIDER: "ftp" }, "STORAGE_PROVIDER must be one of");
  expectFailure("invalid media TTL fails", { MEDIA_URL_TTL_SECONDS: "0" }, "MEDIA_URL_TTL_SECONDS");
  expectFailure("localhost Redis fails in production", { REDIS_URL: "redis://localhost:6379" }, "REDIS_URL must not target localhost");
  expectFailure("production requires proxy trust", { TRUST_PROXY_HOPS: "0" }, "TRUST_PROXY_HOPS must be >= 1");
  expectFailure(
    "enabled payments require Razorpay configuration",
    { SUBSCRIPTION_ENABLED: "true", RAZORPAY_KEY_ID: undefined },
    "RAZORPAY_KEY_ID"
  );

  restoreEnvironment();
  console.log("Runtime configuration contract checks passed.");
}

try {
  main();
} finally {
  restoreEnvironment();
}
