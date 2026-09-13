import { validateEnv, type StorageProviderType } from "./env.validation";

export interface StorageConfig {
  provider: StorageProviderType;
  local: {
    root: string;
  };
  firebase: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
    storageBucket: string;
  };
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    signedUrlExpiresIn: number;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    webhookUrl: string;
    webhookMaxAgeSeconds: number;
  };
}

export function getStorageConfig(): StorageConfig {
  const env = validateEnv();
  return {
    provider: env.storageProvider,
    local: {
      root: env.localStorageRoot,
    },
    firebase: {
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey,
      storageBucket: env.firebaseStorageBucket,
    },
    s3: {
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
      region: env.awsRegion,
      bucket: env.awsS3Bucket,
      signedUrlExpiresIn: env.awsS3SignedUrlExpiresIn,
    },
    cloudinary: {
      cloudName: env.cloudinaryCloudName,
      apiKey: env.cloudinaryApiKey,
      apiSecret: env.cloudinaryApiSecret,
      webhookUrl: env.cloudinaryWebhookUrl,
      webhookMaxAgeSeconds: env.cloudinaryWebhookMaxAgeSeconds,
    },
  };
}
