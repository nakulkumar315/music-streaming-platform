/**
 * Firebase Storage provider using Admin SDK. Section 25.2.
 * Lazy-load firebase-admin to avoid requiring it when using local/s3.
 */

import type { IStorageProvider } from "../interfaces/storage-provider.interface";
import type {
  UploadObjectParams,
  UploadObjectResult,
  ObjectMetadata,
  OpenReadStreamParams,
  OpenReadStreamResult
} from "../interfaces/storage-types.interface";
import { Readable } from "stream";
import {
  StorageUploadFailedException,
  StorageDeleteFailedException,
  StorageReadFailedException
} from "../../exceptions/storage.exception";

export interface FirebaseStorageProviderConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  storageBucket: string;
}

export class FirebaseStorageProvider implements IStorageProvider {
  private bucket: any = null;

  constructor(private readonly config: FirebaseStorageProviderConfig) {}

  private async getBucket() {
    if (this.bucket) return this.bucket;
    const admin = await import("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.config.projectId,
          clientEmail: this.config.clientEmail,
          privateKey: this.config.privateKey
        })
      });
    }
    this.bucket = admin.storage().bucket(this.config.storageBucket);
    return this.bucket;
  }

  async upload(params: UploadObjectParams): Promise<UploadObjectResult> {
    const { storageKey, body, contentType } = params;
    try {
      const bucket = await this.getBucket();
      const file = bucket.file(storageKey);

      if (Buffer.isBuffer(body)) {
        await file.save(body, {
          resumable: false,
          metadata: {
            contentType,
            metadata: params.metadata,
          }
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          const write = file.createWriteStream({
            resumable: false,
            metadata: {
              contentType,
              metadata: params.metadata,
            },
          });
          body.once("error", reject);
          write.once("error", reject);
          write.once("finish", resolve);
          body.pipe(write);
        });
      }

      const [metadata] = await file.getMetadata();
      const sizeBytes = metadata?.size ? Number(metadata.size) : params.contentLength;
      return {
        storageKey,
        providerAssetId: storageKey,
        etag: metadata?.etag,
        sizeBytes: Number.isFinite(sizeBytes) ? Number(sizeBytes) : undefined
      };
    } catch (err: any) {
      throw new StorageUploadFailedException(
        err?.message || "Firebase upload failed",
        storageKey
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      const bucket = await this.getBucket();
      await bucket.file(storageKey).delete();
    } catch (err: any) {
      if (err?.code === 404) return;
      throw new StorageDeleteFailedException(
        err?.message || "Firebase delete failed",
        storageKey
      );
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const bucket = await this.getBucket();
      const [exists] = await bucket.file(storageKey).exists();
      return !!exists;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(storageKey: string): Promise<ObjectMetadata | null> {
    try {
      const bucket = await this.getBucket();
      const [metadata] = await bucket.file(storageKey).getMetadata();
      if (!metadata) return null;
      return {
        storageKey,
        contentType: metadata.contentType,
        contentLength: metadata.size ? parseInt(String(metadata.size), 10) : undefined,
        etag: metadata.etag,
        lastModified: metadata.updated ? new Date(metadata.updated) : undefined
      };
    } catch (err: any) {
      if (err?.code === 404) return null;
      throw new StorageReadFailedException(err?.message || "Firebase getMetadata failed", storageKey);
    }
  }

  async openReadStream(params: OpenReadStreamParams): Promise<OpenReadStreamResult> {
    const { storageKey, start, end } = params;
    try {
      const bucket = await this.getBucket();
      const file = bucket.file(storageKey);
      const options: { start?: number; end?: number } = {};
      if (start !== undefined) options.start = start;
      if (end !== undefined) options.end = end;
      const [metadata] = await file.getMetadata();
      const stream = file.createReadStream(options);
      const contentLength = options.end !== undefined && options.start !== undefined
        ? options.end - options.start + 1
        : metadata?.size ? parseInt(String(metadata.size), 10) : undefined;
      return {
        stream,
        contentType: metadata?.contentType,
        contentLength,
        acceptRanges: true
      };
    } catch (err: any) {
      throw new StorageReadFailedException(err?.message || "Firebase openReadStream failed", storageKey);
    }
  }
}
