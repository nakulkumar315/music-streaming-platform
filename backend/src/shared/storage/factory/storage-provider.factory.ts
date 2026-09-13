/**
 * Canonical storage provider factory.
 * Fails fast on invalid provider configuration and never silently falls back.
 */

import type { IStorageProvider } from "../interfaces/storage-provider.interface";
import type { StorageProviderName } from "../interfaces/storage-types.interface";
import { getStorageConfig } from "../../../config/storage.config";
import { validateEnv } from "../../../config/env.validation";
import { StorageProviderNotConfiguredException } from "../../exceptions/storage.exception";
import { LocalStorageProvider } from "../providers/local-storage.provider";
import { FirebaseStorageProvider } from "../providers/firebase-storage.provider";
import { S3StorageProvider } from "../providers/s3-storage.provider";
import { CloudinaryStorageProvider } from "../providers/cloudinary-storage.provider";

let instance: IStorageProvider | null = null;

function createCloudinary(config: ReturnType<typeof getStorageConfig>) {
  return new CloudinaryStorageProvider({
    cloudName: config.cloudinary.cloudName,
    apiKey: config.cloudinary.apiKey,
    apiSecret: config.cloudinary.apiSecret,
    webhookUrl: config.cloudinary.webhookUrl,
  });
}

export function createStorageProvider(): IStorageProvider {
  if (instance) return instance;
  const config = getStorageConfig();
  const provider = config.provider;

  if (provider === "local") {
    instance = new LocalStorageProvider(config.local.root);
    return instance;
  }

  if (provider === "firebase") {
    instance = new FirebaseStorageProvider({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
      storageBucket: config.firebase.storageBucket,
    });
    return instance;
  }

  if (provider === "s3") {
    instance = new S3StorageProvider({
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      region: config.s3.region,
      bucket: config.s3.bucket,
    });
    return instance;
  }

  if (provider === "cloudinary") {
    instance = createCloudinary(config);
    return instance;
  }

  throw new StorageProviderNotConfiguredException(provider);
}

export function getStorageProvider(): IStorageProvider {
  return createStorageProvider();
}

/** Resolve the provider recorded on a row without changing the active provider. */
export function getStorageProviderByName(provider: StorageProviderName): IStorageProvider {
  const config = getStorageConfig();
  const runtime = validateEnv();

  if (provider === "local") {
    if (runtime.nodeEnv === "production") {
      throw new StorageProviderNotConfiguredException("local (development/test only)");
    }
    return new LocalStorageProvider(config.local.root);
  }

  if (provider === "firebase") {
    if (
      !config.firebase.projectId ||
      !config.firebase.clientEmail ||
      !config.firebase.privateKey ||
      !config.firebase.storageBucket
    ) {
      throw new StorageProviderNotConfiguredException("firebase");
    }
    return new FirebaseStorageProvider({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
      storageBucket: config.firebase.storageBucket,
    });
  }

  if (provider === "s3") {
    if (!config.s3.bucket || !config.s3.region || !config.s3.accessKeyId || !config.s3.secretAccessKey) {
      throw new StorageProviderNotConfiguredException("s3");
    }
    return new S3StorageProvider({
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      region: config.s3.region,
      bucket: config.s3.bucket,
    });
  }

  if (provider === "cloudinary") {
    if (
      !config.cloudinary.cloudName ||
      !config.cloudinary.apiKey ||
      !config.cloudinary.apiSecret ||
      !config.cloudinary.webhookUrl
    ) {
      throw new StorageProviderNotConfiguredException("cloudinary");
    }
    return createCloudinary(config);
  }

  throw new StorageProviderNotConfiguredException(provider);
}
