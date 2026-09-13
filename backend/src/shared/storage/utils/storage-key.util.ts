import { v4 as uuidv4 } from "uuid";

/**
 * Deterministic storage key format.
 * artists/{artistId}/{mediaType}/{yyyy}/{mm}/{uuid}.{ext}
 * Never use raw user filename as path.
 */

export type MediaTypeCategory = "audio" | "video" | "thumbnails" | "images";

const ALLOWED_EXT_BY_MEDIA: Record<MediaTypeCategory, string[]> = {
  audio: ["mp3", "m4a", "wav", "aac"],
  video: ["mp4", "mov"],
  thumbnails: ["jpg", "jpeg", "png", "webp"],
  images: ["jpg", "jpeg", "png", "webp"],
};

function normalizeExt(ext: string, mediaType: MediaTypeCategory): string {
  const allowed = ALLOWED_EXT_BY_MEDIA[mediaType];
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  if (allowed.includes(e)) return e;
  return allowed[0] ?? "bin";
}

export function generateStorageKey(
  artistId: number,
  mediaType: MediaTypeCategory,
  extension: string,
  contentId?: number
): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = normalizeExt(extension, mediaType);
  const shortUuid = uuidv4().replace(/-/g, "").slice(0, 8);
  const segment = contentId ? `${contentId}_${shortUuid}` : shortUuid;
  return `artists/${artistId}/${mediaType}/${yyyy}/${mm}/${segment}.${ext}`;
}
