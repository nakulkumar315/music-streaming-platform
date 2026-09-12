import { isValidPublicId, normalizePublicId } from "../utils/cloudinary.utils";

export type MediaAssetKind = "audio" | "video" | "thumbnail";

export interface ContentMediaIdentityRow {
  storage_provider?: string | null;
  type?: string | null;
  storage_key?: string | null;
  video_storage_key?: string | null;
  thumbnail_storage_key?: string | null;
  provider_asset_id?: string | null;
  audio_provider_asset_id?: string | null;
  video_provider_asset_id?: string | null;
  thumbnail_provider_asset_id?: string | null;
}

export interface ResolvedMediaIdentity {
  provider: string;
  internalStorageKey: string | null;
  providerAssetId: string | null;
}

function normalizeProvider(provider: string | null | undefined): string {
  return String(provider || "").trim().toLowerCase();
}

function normalizeExplicitCloudinaryId(candidate: string | null | undefined): string | null {
  const raw = String(candidate || "").trim();
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) return null;
  try {
    const normalized = normalizePublicId(raw);
    return isValidPublicId(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function resolveInternalStorageKey(
  row: ContentMediaIdentityRow,
  kind: MediaAssetKind
): string | null {
  if (kind === "thumbnail") return row.thumbnail_storage_key ?? null;
  if (kind === "video") return row.video_storage_key ?? row.storage_key ?? null;
  return row.storage_key ?? null;
}

function resolveCloudinaryProviderAssetId(
  row: ContentMediaIdentityRow,
  kind: MediaAssetKind
): string | null {
  const type = String(row.type || "").toLowerCase();
  const isVideoContent = type.includes("video");

  if (kind === "thumbnail") {
    return normalizeExplicitCloudinaryId(row.thumbnail_provider_asset_id);
  }
  if (kind === "video") {
    return (
      normalizeExplicitCloudinaryId(row.video_provider_asset_id) ||
      (isVideoContent ? normalizeExplicitCloudinaryId(row.provider_asset_id) : null)
    );
  }
  return (
    normalizeExplicitCloudinaryId(row.audio_provider_asset_id) ||
    (!isVideoContent ? normalizeExplicitCloudinaryId(row.provider_asset_id) : null)
  );
}

/**
 * Resolve only explicit database identities. Raw public URLs and hard-coded
 * development assets are never treated as an authorization-safe media identity.
 */
export function resolveMediaIdentity(
  row: ContentMediaIdentityRow,
  kind: MediaAssetKind
): ResolvedMediaIdentity {
  const provider = normalizeProvider(row.storage_provider);
  const internalStorageKey = resolveInternalStorageKey(row, kind);

  return {
    provider,
    internalStorageKey,
    providerAssetId:
      provider === "cloudinary" ? resolveCloudinaryProviderAssetId(row, kind) : null,
  };
}
