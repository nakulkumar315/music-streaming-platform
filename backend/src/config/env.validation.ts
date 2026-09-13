/**
 * Environment validation at boot. Fail-fast if required vars are missing or invalid.
 * Section 5 & 26: STORAGE_PROVIDER, provider-specific vars, media/upload limits.
 */

const STORAGE_PROVIDERS = ["local", "firebase", "s3", "cloudinary"] as const;
export type StorageProviderType = (typeof STORAGE_PROVIDERS)[number];

function envStr(key: string, defaultValue?: string): string {
  const v = process.env[key];
  if (defaultValue !== undefined && (v === undefined || v === "")) return defaultValue;
  if (v === undefined || v === "") {
    throw new Error(`[env] Missing or empty required env: ${key}`);
  }
  return v.trim();
}

function envInt(key: string, defaultValue?: number): number {
  const v = process.env[key];
  if (defaultValue !== undefined && (v === undefined || v === "")) return defaultValue;
  const n = parseInt(String(process.env[key] || ""), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`[env] Invalid or missing integer env: ${key}`);
  }
  return n;
}

export interface EnvValidationResult {
  storageProvider: StorageProviderType;
  appBaseUrl: string;
  localStorageRoot: string;
  localPrivateStreamRoute: string;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  firebaseStorageBucket: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  awsS3Bucket: string;
  awsS3SignedUrlExpiresIn: number;
  mediaSignedTokenSecret: string;
  mediaUrlTtlSeconds: number;
  maxUploadAudioMb: number;
  maxUploadVideoMb: number;
  maxUploadImageMb: number;
  subscriptionEnabled: boolean;
}

let cached: EnvValidationResult | null = null;

export function resetEnvCache() {
  cached = null;
}

export function validateEnv(): EnvValidationResult {
  if (cached) return cached;

  envStr("JWT_SECRET");
  envStr("SIGNATURE_ENCRYPTION_KEY");

  const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase();
  const configuredProvider = String(process.env.STORAGE_PROVIDER || "").trim().toLowerCase();
  if (!configuredProvider && nodeEnv === "production") {
    throw new Error("[env] STORAGE_PROVIDER is required in production");
  }
  const rawProvider = configuredProvider || "local";
  if (!STORAGE_PROVIDERS.includes(rawProvider as StorageProviderType)) {
    throw new Error(
      `[env] STORAGE_PROVIDER must be one of: ${STORAGE_PROVIDERS.join(", ")}. Got: ${rawProvider}`
    );
  }
  const storageProvider = rawProvider as StorageProviderType;
  if (nodeEnv === "production" && storageProvider === "local") {
    throw new Error("[env] STORAGE_PROVIDER=local is development/test only and is forbidden in production");
  }

  const appBaseUrl = envStr("APP_BASE_URL", "http://localhost:3000");
  const localStorageRoot = envStr("LOCAL_STORAGE_ROOT", "./storage");
  const localPrivateStreamRoute = envStr("LOCAL_PRIVATE_STREAM_ROUTE", "/media/stream");

  let firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
  let firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? "";
  let firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.trim() ?? "";
  let firebaseStorageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() ?? "";

  if (storageProvider === "firebase") {
    if (!firebaseProjectId) throw new Error("[env] FIREBASE_PROJECT_ID is required when STORAGE_PROVIDER=firebase");
    if (!firebaseClientEmail) throw new Error("[env] FIREBASE_CLIENT_EMAIL is required when STORAGE_PROVIDER=firebase");
    if (!firebasePrivateKey) throw new Error("[env] FIREBASE_PRIVATE_KEY is required when STORAGE_PROVIDER=firebase");
    if (!firebaseStorageBucket) throw new Error("[env] FIREBASE_STORAGE_BUCKET is required when STORAGE_PROVIDER=firebase");
    firebasePrivateKey = firebasePrivateKey.replace(/\\n/g, "\n");
  }

  const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() ?? "";
  const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? "";
  const awsRegion = process.env.AWS_REGION?.trim() ?? "";
  const awsS3Bucket = process.env.AWS_S3_BUCKET?.trim() ?? "";
  const awsS3SignedUrlExpiresIn = envInt("AWS_S3_SIGNED_URL_EXPIRES_IN", 300);

  if (storageProvider === "s3") {
    if (!awsAccessKeyId) throw new Error("[env] AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3");
    if (!awsSecretAccessKey) throw new Error("[env] AWS_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=s3");
    if (!awsRegion) throw new Error("[env] AWS_REGION is required when STORAGE_PROVIDER=s3");
    if (!awsS3Bucket) throw new Error("[env] AWS_S3_BUCKET is required when STORAGE_PROVIDER=s3");
  }

  if (storageProvider === "cloudinary") {
    envStr("CLOUDINARY_CLOUD_NAME");
    envStr("CLOUDINARY_API_KEY");
    envStr("CLOUDINARY_API_SECRET");
    // Phase 1 includes video; Cloudinary video eager processing therefore needs
    // an authenticated callback path before the service is considered ready.
    envStr("CLOUDINARY_WEBHOOK_URL");
  }

  const mediaSignedTokenSecret = envStr("MEDIA_SIGNED_TOKEN_SECRET");
  const mediaUrlTtlSeconds = envInt("MEDIA_URL_TTL_SECONDS", 300);
  const maxUploadAudioMb = envInt("MAX_UPLOAD_AUDIO_MB", 50);
  const maxUploadVideoMb = envInt("MAX_UPLOAD_VIDEO_MB", 500);
  const maxUploadImageMb = envInt("MAX_UPLOAD_IMAGE_MB", 10);
  const subscriptionEnabled = process.env.SUBSCRIPTION_ENABLED?.toLowerCase() !== "false";

  if (maxUploadAudioMb <= 0 || maxUploadVideoMb <= 0 || maxUploadImageMb <= 0) {
    throw new Error("[env] Upload limits must be positive integers");
  }

  cached = {
    storageProvider,
    appBaseUrl,
    localStorageRoot,
    localPrivateStreamRoute,
    firebaseProjectId,
    firebaseClientEmail,
    firebasePrivateKey,
    firebaseStorageBucket,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRegion,
    awsS3Bucket,
    awsS3SignedUrlExpiresIn,
    mediaSignedTokenSecret,
    mediaUrlTtlSeconds,
    maxUploadAudioMb,
    maxUploadVideoMb,
    maxUploadImageMb,
    subscriptionEnabled,
  };
  return cached;
}
