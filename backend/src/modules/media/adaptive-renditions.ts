export type AdaptiveQuality = "144p" | "240p" | "360p" | "480p" | "720p" | "1080p";

export type AdaptiveRenditionDefinition = {
  quality: AdaptiveQuality;
  width: number;
  height: number;
  bitRate: string;
};

export const ADAPTIVE_RENDITION_LADDER: readonly AdaptiveRenditionDefinition[] = [
  { quality: "144p", width: 256, height: 144, bitRate: "100k" },
  { quality: "240p", width: 426, height: 240, bitRate: "200k" },
  { quality: "360p", width: 640, height: 360, bitRate: "400k" },
  { quality: "480p", width: 854, height: 480, bitRate: "700k" },
  { quality: "720p", width: 1280, height: 720, bitRate: "1500k" },
  { quality: "1080p", width: 1920, height: 1080, bitRate: "3000k" },
] as const;

export function renditionsForSourceHeight(sourceHeight: unknown): AdaptiveRenditionDefinition[] {
  const height = Number(sourceHeight);
  if (!Number.isFinite(height) || height <= 0) return [];
  return ADAPTIVE_RENDITION_LADDER.filter((rendition) => rendition.height <= height);
}

export function qualitiesForSourceHeight(sourceHeight: unknown): AdaptiveQuality[] {
  return renditionsForSourceHeight(sourceHeight).map((rendition) => rendition.quality);
}

export function cloudinaryEagerTransformsForSourceHeight(sourceHeight: unknown) {
  return [
    ...renditionsForSourceHeight(sourceHeight).map((rendition) => ({
      width: rendition.width,
      height: rendition.height,
      crop: "limit",
      bit_rate: rendition.bitRate,
      format: "m3u8",
    })),
    { streaming_profile: "auto", format: "m3u8" },
  ];
}

export function successfulHlsResultCount(eager: unknown): number {
  if (!Array.isArray(eager)) return 0;
  return eager.filter((entry: any) => {
    const status = String(entry?.status || entry?.state || "").trim().toLowerCase();
    const url = String(entry?.secure_url || entry?.url || "").trim().toLowerCase();
    const format = String(entry?.format || "").trim().toLowerCase();
    const success = !status || ["success", "succeeded", "complete", "completed", "ready"].includes(status);
    return success && (format === "m3u8" || url.includes(".m3u8"));
  }).length;
}
