/**
 * Canonical backend runtime configuration.
 * Parse and validate environment input once; downstream modules consume this
 * contract instead of interpreting process.env independently.
 */

const STORAGE_PROVIDERS = ["local", "firebase", "s3", "cloudinary"] as const;
const NODE_ENVS = ["development", "test", "production"] as const;

export type StorageProviderType = (typeof STORAGE_PROVIDERS)[number];
export type RuntimeNodeEnv = (typeof NODE_ENVS)[number];

function envOptional(key: string): string {
  return String(process.env[key] || "").trim();
}

function envStr(key: string, defaultValue?: string): string {
  const raw = envOptional(key);
  if (!raw && defaultValue !== undefined) return defaultValue;
  if (!raw) throw new Error(`[env] Missing or empty required env: ${key}`);
  return raw;
}

function envInt(
  key: string,
  options: { defaultValue?: number; min?: number; max?: number } = {}
): number {
  const raw = envOptional(key);
  if (!raw && options.defaultValue !== undefined) return options.defaultValue;
  if (!raw || !/^-?\d+$/.test(raw)) throw new Error(`[env] Invalid or missing integer env: ${key}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`[env] Invalid integer env: ${key}`);
  if (options.min !== undefined && value < options.min) throw new Error(`[env] ${key} must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max) throw new Error(`[env] ${key} must be <= ${options.max}`);
  return value;
}

function envBoolean(key: string, defaultValue: boolean): boolean {
  const raw = envOptional(key).toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`[env] ${key} must be true or false`);
}

function parseUrl(
  key: string,
  raw: string,
  protocols: string[],
  options: { allowCredentials?: boolean } = {}
): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[env] ${key} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`[env] ${key} must use ${protocols.join(" or ")}`);
  }
  if (!options.allowCredentials && (parsed.username || parsed.password)) {
    throw new Error(`[env] ${key} must not embed credentials`);
  }
  return parsed;
}

function parseDatabaseUrl(key: string, raw: string): string {
  const parsed = parseUrl(key, raw, ["postgres:", "postgresql:"], { allowCredentials: true });
  if (!parsed.hostname) throw new Error(`[env] ${key} must identify a database host`);
  return raw;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function assertProductionPublicUrl(key: string, parsed: URL, nodeEnv: RuntimeNodeEnv) {
  if (nodeEnv !== "production") return;
  if (parsed.protocol !== "https:") throw new Error(`[env] ${key} must use https:// in production`);
  if (isLocalHostname(parsed.hostname)) throw new Error(`[env] ${key} must not target localhost in production`);
}

const PLACEHOLDER_SECRET = /(replace[-_ ]?me|change[-_ ]?me|changeme|placeholder|your[-_]|example[-_ ]?secret|secret[-_ ]?here)/i;

function assertProductionSecret(key: string, value: string, nodeEnv: RuntimeNodeEnv, minLength = 24) {
  if (nodeEnv !== "production") return;
  if (value.length < minLength) throw new Error(`[env] ${key} is too short for production`);
  if (PLACEHOLDER_SECRET.test(value)) throw new Error(`[env] ${key} contains a placeholder value`);
}

function parseCorsOrigins(nodeEnv: RuntimeNodeEnv): string[] {
  const raw = envOptional("CORS_ALLOWED_ORIGINS");
  if (!raw) {
    if (nodeEnv === "production") throw new Error("[env] CORS_ALLOWED_ORIGINS is required in production");
    return ["*"];
  }

  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!values.length) throw new Error("[env] CORS_ALLOWED_ORIGINS must contain at least one origin");
  if (nodeEnv === "production" && values.includes("*")) {
    throw new Error("[env] CORS_ALLOWED_ORIGINS cannot contain * in production");
  }

  return values.map((origin) => {
    if (origin === "*") return origin;
    const parsed = parseUrl("CORS_ALLOWED_ORIGINS", origin, ["http:", "https:"]);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("[env] CORS_ALLOWED_ORIGINS entries must be origins without path/query/hash");
    }
    assertProductionPublicUrl("CORS_ALLOWED_ORIGINS", parsed, nodeEnv);
    return parsed.origin;
  });
}

export interface EnvValidationResult {
  nodeEnv: RuntimeNodeEnv;
  port: number;
  databaseUrl: string;
  databaseReplicaUrl: string;
  jwtSecret: string;
  signatureEncryptionKey: string;
  storageProvider: StorageProviderType;
  appBaseUrl: string;
  corsAllowedOrigins: string[];
  trustProxyHops: number;
  redisUrl: string | null;
  sentryDsn: string | null;
  sentryRelease: string | null;
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
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  cloudinaryWebhookUrl: string;
  cloudinaryWebhookMaxAgeSeconds: number;
  mediaSignedTokenSecret: string;
  mediaUrlTtlSeconds: number;
  maxUploadAudioMb: number;
  maxUploadVideoMb: number;
  maxUploadImageMb: number;
  subscriptionEnabled: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
}

let cached: EnvValidationResult | null = null;

export function resetEnvCache() {
  cached = null;
}

export function validateEnv(): EnvValidationResult {
  if (cached) return cached;

  const nodeEnvRaw = envOptional("NODE_ENV") || "development";
  if (!NODE_ENVS.includes(nodeEnvRaw as RuntimeNodeEnv)) {
    throw new Error(`[env] NODE_ENV must be one of: ${NODE_ENVS.join(", ")}`);
  }
  const nodeEnv = nodeEnvRaw as RuntimeNodeEnv;
  const port = envInt("PORT", { defaultValue: 8000, min: 1, max: 65535 });

  const databaseUrl = parseDatabaseUrl("DATABASE_URL", envStr("DATABASE_URL"));
  const databaseReplicaRaw = envOptional("DATABASE_URL_REPLICA");
  const databaseReplicaUrl = databaseReplicaRaw
    ? parseDatabaseUrl("DATABASE_URL_REPLICA", databaseReplicaRaw)
    : databaseUrl;

  const jwtSecret = envStr("JWT_SECRET");
  const signatureEncryptionKey = envStr("SIGNATURE_ENCRYPTION_KEY");
  const mediaSignedTokenSecret = envStr("MEDIA_SIGNED_TOKEN_SECRET");
  assertProductionSecret("JWT_SECRET", jwtSecret, nodeEnv, 32);
  assertProductionSecret("SIGNATURE_ENCRYPTION_KEY", signatureEncryptionKey, nodeEnv, 32);
  assertProductionSecret("MEDIA_SIGNED_TOKEN_SECRET", mediaSignedTokenSecret, nodeEnv, 32);

  const configuredProvider = envOptional("STORAGE_PROVIDER");
  if (!configuredProvider && nodeEnv === "production") throw new Error("[env] STORAGE_PROVIDER is required in production");
  const rawProvider = (configuredProvider || "local").toLowerCase();
  if (!STORAGE_PROVIDERS.includes(rawProvider as StorageProviderType)) {
    throw new Error(`[env] STORAGE_PROVIDER must be one of: ${STORAGE_PROVIDERS.join(", ")}`);
  }
  const storageProvider = rawProvider as StorageProviderType;
  if (nodeEnv === "production" && storageProvider === "local") {
    throw new Error("[env] STORAGE_PROVIDER=local is development/test only and is forbidden in production");
  }

  const appBaseRaw = nodeEnv === "production"
    ? envStr("APP_BASE_URL")
    : envStr("APP_BASE_URL", "http://localhost:8000");
  const appBaseParsed = parseUrl("APP_BASE_URL", appBaseRaw, ["http:", "https:"]);
  if (appBaseParsed.pathname !== "/" || appBaseParsed.search || appBaseParsed.hash) {
    throw new Error("[env] APP_BASE_URL must be an origin without path/query/hash");
  }
  assertProductionPublicUrl("APP_BASE_URL", appBaseParsed, nodeEnv);
  const appBaseUrl = appBaseParsed.origin;

  const corsAllowedOrigins = parseCorsOrigins(nodeEnv);
  const trustProxyHops = nodeEnv === "production"
    ? envInt("TRUST_PROXY_HOPS", { min: 1, max: 5 })
    : envInt("TRUST_PROXY_HOPS", { defaultValue: 0, min: 0, max: 5 });

  const redisRaw = envOptional("REDIS_URL");
  let redisUrl: string | null = null;
  if (redisRaw && redisRaw.toLowerCase() !== "disabled") {
    const parsed = parseUrl("REDIS_URL", redisRaw, ["redis:", "rediss:"], { allowCredentials: true });
    if (nodeEnv === "production" && isLocalHostname(parsed.hostname)) {
      throw new Error("[env] REDIS_URL must not target localhost in production");
    }
    redisUrl = parsed.toString();
  }

  const sentryRaw = envOptional("SENTRY_DSN");
  let sentryDsn: string | null = null;
  if (sentryRaw) {
    const parsed = parseUrl("SENTRY_DSN", sentryRaw, ["http:", "https:"], { allowCredentials: true });
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
      throw new Error("[env] SENTRY_DSN must include a project path");
    }
    sentryDsn = parsed.toString();
  }
  const sentryRelease = envOptional("SENTRY_RELEASE") || null;

  const localStorageRoot = envStr("LOCAL_STORAGE_ROOT", "./storage");
  const localPrivateStreamRoute = envStr("LOCAL_PRIVATE_STREAM_ROUTE", "/media/stream");
  if (!localPrivateStreamRoute.startsWith("/") || localPrivateStreamRoute.includes("..")) {
    throw new Error("[env] LOCAL_PRIVATE_STREAM_ROUTE must be an absolute application path");
  }

  let firebaseProjectId = envOptional("FIREBASE_PROJECT_ID");
  let firebaseClientEmail = envOptional("FIREBASE_CLIENT_EMAIL");
  let firebasePrivateKey = envOptional("FIREBASE_PRIVATE_KEY");
  let firebaseStorageBucket = envOptional("FIREBASE_STORAGE_BUCKET");
  if (storageProvider === "firebase") {
    if (!firebaseProjectId) throw new Error("[env] FIREBASE_PROJECT_ID is required when STORAGE_PROVIDER=firebase");
    if (!firebaseClientEmail) throw new Error("[env] FIREBASE_CLIENT_EMAIL is required when STORAGE_PROVIDER=firebase");
    if (!firebasePrivateKey) throw new Error("[env] FIREBASE_PRIVATE_KEY is required when STORAGE_PROVIDER=firebase");
    if (!firebaseStorageBucket) throw new Error("[env] FIREBASE_STORAGE_BUCKET is required when STORAGE_PROVIDER=firebase");
    firebasePrivateKey = firebasePrivateKey.replace(/\\n/g, "\n");
  }

  const awsAccessKeyId = envOptional("AWS_ACCESS_KEY_ID");
  const awsSecretAccessKey = envOptional("AWS_SECRET_ACCESS_KEY");
  const awsRegion = envOptional("AWS_REGION");
  const awsS3Bucket = envOptional("AWS_S3_BUCKET");
  const awsS3SignedUrlExpiresIn = envInt("AWS_S3_SIGNED_URL_EXPIRES_IN", { defaultValue: 300, min: 30, max: 3600 });
  if (storageProvider === "s3") {
    if (!awsAccessKeyId) throw new Error("[env] AWS_ACCESS_KEY_ID is required when STORAGE_PROVIDER=s3");
    if (!awsSecretAccessKey) throw new Error("[env] AWS_SECRET_ACCESS_KEY is required when STORAGE_PROVIDER=s3");
    if (!awsRegion) throw new Error("[env] AWS_REGION is required when STORAGE_PROVIDER=s3");
    if (!awsS3Bucket) throw new Error("[env] AWS_S3_BUCKET is required when STORAGE_PROVIDER=s3");
  }

  const cloudinaryCloudName = envOptional("CLOUDINARY_CLOUD_NAME");
  const cloudinaryApiKey = envOptional("CLOUDINARY_API_KEY");
  const cloudinaryApiSecret = envOptional("CLOUDINARY_API_SECRET");
  const cloudinaryWebhookRaw = envOptional("CLOUDINARY_WEBHOOK_URL");
  const cloudinaryWebhookMaxAgeSeconds = envInt("CLOUDINARY_WEBHOOK_MAX_AGE_SECONDS", { defaultValue: 7200, min: 60, max: 7200 });
  let cloudinaryWebhookUrl = cloudinaryWebhookRaw;
  if (storageProvider === "cloudinary") {
    if (!cloudinaryCloudName) throw new Error("[env] CLOUDINARY_CLOUD_NAME is required when STORAGE_PROVIDER=cloudinary");
    if (!cloudinaryApiKey) throw new Error("[env] CLOUDINARY_API_KEY is required when STORAGE_PROVIDER=cloudinary");
    if (!cloudinaryApiSecret) throw new Error("[env] CLOUDINARY_API_SECRET is required when STORAGE_PROVIDER=cloudinary");
    if (!cloudinaryWebhookRaw) throw new Error("[env] CLOUDINARY_WEBHOOK_URL is required when STORAGE_PROVIDER=cloudinary");
    const webhook = parseUrl("CLOUDINARY_WEBHOOK_URL", cloudinaryWebhookRaw, ["http:", "https:"]);
    assertProductionPublicUrl("CLOUDINARY_WEBHOOK_URL", webhook, nodeEnv);
    cloudinaryWebhookUrl = webhook.toString();
    assertProductionSecret("CLOUDINARY_API_SECRET", cloudinaryApiSecret, nodeEnv, 16);
  }

  const mediaUrlTtlSeconds = envInt("MEDIA_URL_TTL_SECONDS", { defaultValue: 300, min: 30, max: 3600 });
  const maxUploadAudioMb = envInt("MAX_UPLOAD_AUDIO_MB", { defaultValue: 50, min: 1, max: 1024 });
  const maxUploadVideoMb = envInt("MAX_UPLOAD_VIDEO_MB", { defaultValue: 500, min: 1, max: 10240 });
  const maxUploadImageMb = envInt("MAX_UPLOAD_IMAGE_MB", { defaultValue: 10, min: 1, max: 100 });

  const subscriptionEnabled = envBoolean("SUBSCRIPTION_ENABLED", true);
  let razorpayKeyId = envOptional("RAZORPAY_KEY_ID");
  let razorpayKeySecret = envOptional("RAZORPAY_KEY_SECRET");
  let razorpayWebhookSecret = envOptional("RAZORPAY_WEBHOOK_SECRET");
  if (subscriptionEnabled) {
    razorpayKeyId = envStr("RAZORPAY_KEY_ID");
    razorpayKeySecret = envStr("RAZORPAY_KEY_SECRET");
    razorpayWebhookSecret = envStr("RAZORPAY_WEBHOOK_SECRET");
    assertProductionSecret("RAZORPAY_KEY_SECRET", razorpayKeySecret, nodeEnv, 16);
    assertProductionSecret("RAZORPAY_WEBHOOK_SECRET", razorpayWebhookSecret, nodeEnv, 16);
    if (nodeEnv === "production" && PLACEHOLDER_SECRET.test(razorpayKeyId)) {
      throw new Error("[env] RAZORPAY_KEY_ID contains a placeholder value");
    }
  }

  cached = {
    nodeEnv,
    port,
    databaseUrl,
    databaseReplicaUrl,
    jwtSecret,
    signatureEncryptionKey,
    storageProvider,
    appBaseUrl,
    corsAllowedOrigins,
    trustProxyHops,
    redisUrl,
    sentryDsn,
    sentryRelease,
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
    cloudinaryCloudName,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    cloudinaryWebhookUrl,
    cloudinaryWebhookMaxAgeSeconds,
    mediaSignedTokenSecret,
    mediaUrlTtlSeconds,
    maxUploadAudioMb,
    maxUploadVideoMb,
    maxUploadImageMb,
    subscriptionEnabled,
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
  };
  return cached;
}
