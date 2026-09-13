import fs from "fs/promises";

export type UploadMediaKind = "audio" | "video" | "thumbnail";

const ALLOWED_MIME: Record<UploadMediaKind, Set<string>> = {
  audio: new Set([
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
  ]),
  video: new Set(["video/mp4", "video/quicktime"]),
  thumbnail: new Set(["image/jpeg", "image/png", "image/webp"]),
};

export class UploadValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

function ascii(buffer: Buffer, start: number, end: number) {
  return buffer.subarray(start, end).toString("ascii");
}

function isJpeg(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    ascii(buffer, 1, 4) === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isWebp(buffer: Buffer) {
  return buffer.length >= 12 && ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP";
}

function isWav(buffer: Buffer) {
  return buffer.length >= 12 && ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WAVE";
}

function isMp3(buffer: Buffer) {
  if (buffer.length >= 3 && ascii(buffer, 0, 3) === "ID3") return true;
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function isAacAdts(buffer: Buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
}

function isIsoBaseMedia(buffer: Buffer) {
  return buffer.length >= 12 && ascii(buffer, 4, 8) === "ftyp";
}

function signatureMatches(kind: UploadMediaKind, mimeType: string, header: Buffer) {
  if (kind === "thumbnail") {
    if (mimeType === "image/jpeg") return isJpeg(header);
    if (mimeType === "image/png") return isPng(header);
    if (mimeType === "image/webp") return isWebp(header);
    return false;
  }

  if (kind === "video") {
    return isIsoBaseMedia(header);
  }

  if (["audio/mpeg", "audio/mp3"].includes(mimeType)) return isMp3(header);
  if (["audio/wav", "audio/x-wav"].includes(mimeType)) return isWav(header);
  if (mimeType === "audio/aac") return isAacAdts(header);
  if (["audio/mp4", "audio/x-m4a"].includes(mimeType)) return isIsoBaseMedia(header);
  return false;
}

export async function validateSpooledFile(input: {
  path: string;
  mimeType: string;
  sizeBytes: number;
  maxSizeBytes: number;
  kind: UploadMediaKind;
}) {
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  if (!ALLOWED_MIME[input.kind].has(mimeType)) {
    throw new UploadValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      `Unsupported ${input.kind} media type`
    );
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadValidationError("EMPTY_UPLOAD", `${input.kind} file is empty`);
  }
  if (input.sizeBytes > input.maxSizeBytes) {
    throw new UploadValidationError("UPLOAD_TOO_LARGE", `${input.kind} file exceeds the configured limit`);
  }

  const handle = await fs.open(input.path, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!signatureMatches(input.kind, mimeType, header.subarray(0, bytesRead))) {
      throw new UploadValidationError(
        "MEDIA_SIGNATURE_MISMATCH",
        `${input.kind} file content does not match its declared media type`
      );
    }
  } finally {
    await handle.close();
  }

  return { mimeType };
}

export function validateUploadMetadata(input: {
  artistId: unknown;
  title: unknown;
  genre: unknown;
  contentType: unknown;
  subscriptionRequired?: unknown;
}) {
  const artistId = Number(input.artistId);
  if (!Number.isSafeInteger(artistId) || artistId <= 0) {
    throw new UploadValidationError("INVALID_ARTIST_ID", "artistId is invalid");
  }

  const title = String(input.title || "").trim();
  if (title.length < 1 || title.length > 200) {
    throw new UploadValidationError("INVALID_TITLE", "title must be 1-200 characters");
  }

  const genre = String(input.genre || "").trim();
  if (genre.length < 1 || genre.length > 80) {
    throw new UploadValidationError("INVALID_GENRE", "genre must be 1-80 characters");
  }

  const contentType = String(input.contentType || "").trim().toUpperCase();
  if (contentType !== "AUDIO" && contentType !== "VIDEO") {
    throw new UploadValidationError("INVALID_CONTENT_TYPE", "contentType must be AUDIO or VIDEO");
  }

  const subscriptionRequired =
    input.subscriptionRequired === true || String(input.subscriptionRequired || "").toLowerCase() === "true";

  return {
    artistId,
    title,
    genre,
    contentType: contentType as "AUDIO" | "VIDEO",
    subscriptionRequired,
  };
}
