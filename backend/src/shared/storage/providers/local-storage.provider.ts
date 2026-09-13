import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import type { IStorageProvider } from "../interfaces/storage-provider.interface";
import type {
  UploadObjectParams,
  UploadObjectResult,
  ObjectMetadata,
  OpenReadStreamParams,
  OpenReadStreamResult,
} from "../interfaces/storage-types.interface";
import { resolveSafePath, isSafeStorageKey } from "../utils/path-safety.util";
import {
  StorageUploadFailedException,
  StoragePathTraversalException,
} from "../../exceptions/storage.exception";

/**
 * Development/test local disk provider. It preserves the production upload
 * memory-safety property by streaming bodies to disk instead of buffering them.
 */
export class LocalStorageProvider implements IStorageProvider {
  constructor(private readonly rootDir: string) {}

  private getMetaPath(storageKey: string): string {
    return `${this.getAbsolutePath(storageKey)}.meta.json`;
  }

  private getAbsolutePath(storageKey: string): string {
    if (!isSafeStorageKey(storageKey)) {
      throw new StoragePathTraversalException();
    }
    return resolveSafePath(path.resolve(this.rootDir), storageKey);
  }

  private ensureDirFor(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  async upload(params: UploadObjectParams): Promise<UploadObjectResult> {
    const absolutePath = this.getAbsolutePath(params.storageKey);
    try {
      this.ensureDirFor(absolutePath);
      if (Buffer.isBuffer(params.body)) {
        await fs.promises.writeFile(absolutePath, params.body, { flag: "w" });
      } else {
        await pipeline(params.body as Readable, fs.createWriteStream(absolutePath, { flags: "w" }));
      }

      const stat = await fs.promises.stat(absolutePath);
      await fs.promises
        .writeFile(
          this.getMetaPath(params.storageKey),
          JSON.stringify({ contentType: params.contentType || null }, null, 2),
          { flag: "w" }
        )
        .catch(() => undefined);

      return {
        storageKey: params.storageKey,
        providerAssetId: params.storageKey,
        sizeBytes: stat.size,
      };
    } catch (err: any) {
      await fs.promises.unlink(absolutePath).catch(() => undefined);
      throw new StorageUploadFailedException(
        err?.message || "Local upload failed",
        params.storageKey
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = this.getAbsolutePath(storageKey);
    await fs.promises.unlink(absolutePath).catch((error: any) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await fs.promises.unlink(this.getMetaPath(storageKey)).catch(() => undefined);
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.promises.access(this.getAbsolutePath(storageKey), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(storageKey: string): Promise<ObjectMetadata | null> {
    const absolutePath = this.getAbsolutePath(storageKey);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }

    let contentType: string | undefined;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.getMetaPath(storageKey), "utf8"));
      if (typeof parsed?.contentType === "string") contentType = parsed.contentType;
    } catch {
      contentType = undefined;
    }

    return {
      storageKey,
      contentLength: stat.size,
      lastModified: stat.mtime,
      contentType,
    };
  }

  async openReadStream(params: OpenReadStreamParams): Promise<OpenReadStreamResult> {
    const absolutePath = this.getAbsolutePath(params.storageKey);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        const notFound = new Error("File not found") as NodeJS.ErrnoException;
        notFound.code = "ENOENT";
        throw notFound;
      }
      throw error;
    }

    const options: { start?: number; end?: number } = {};
    if (params.start !== undefined) options.start = params.start;
    if (params.end !== undefined) options.end = params.end;
    const contentLength =
      options.start !== undefined && options.end !== undefined
        ? options.end - options.start + 1
        : stat.size;

    return {
      stream: fs.createReadStream(absolutePath, options),
      contentLength,
      acceptRanges: true,
    };
  }
}
