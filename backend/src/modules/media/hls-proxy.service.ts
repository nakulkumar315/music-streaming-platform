import { Readable } from "stream";
import type { Request, Response } from "express";
import { getMediaConfig } from "../../config/media.config";
import { createHlsResourceToken } from "../../shared/security/hls-resource-token.service";

const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

function protectedStreamBase(mediaId: number) {
  const config = getMediaConfig();
  const baseUrl = config.appBaseUrl.replace(/\/$/, "");
  const route = config.localPrivateStreamRoute.replace(/^\/+|\/+$/g, "");
  return `${baseUrl}/${route}/${mediaId}/hls`;
}

export function isAllowedAdaptiveUpstream(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "res.cloudinary.com";
  } catch {
    return false;
  }
}

function protectedResourceUrl(input: {
  mediaId: number;
  userId: number;
  sessionId: number;
  expiresAtEpochSeconds: number;
  upstreamUrl: string;
}) {
  const token = createHlsResourceToken(input);
  return `${protectedStreamBase(input.mediaId)}?resource=${encodeURIComponent(token)}`;
}

export function rewriteHlsManifest(input: {
  manifest: string;
  upstreamManifestUrl: string;
  mediaId: number;
  userId: number;
  sessionId: number;
  expiresAtEpochSeconds: number;
}): string {
  if (!input.manifest.trimStart().startsWith("#EXTM3U")) {
    throw new Error("Upstream adaptive response is not an HLS manifest");
  }

  const rewriteUri = (raw: string) => {
    const upstream = new URL(raw, input.upstreamManifestUrl).toString();
    if (!isAllowedAdaptiveUpstream(upstream)) {
      throw new Error("HLS manifest referenced a disallowed upstream host");
    }
    return protectedResourceUrl({
      mediaId: input.mediaId,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAtEpochSeconds: input.expiresAtEpochSeconds,
      upstreamUrl: upstream,
    });
  };

  return input.manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) return rewriteUri(line.trim());
      return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${rewriteUri(uri)}"`);
    })
    .join("\n");
}

async function fetchAdaptiveUpstream(url: string, range?: string) {
  if (!isAllowedAdaptiveUpstream(url)) throw new Error("Adaptive upstream host is not allowed");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: range ? { Range: range } : undefined,
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Adaptive upstream redirect is not allowed");
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function setProtectedMediaHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export async function proxyHlsResource(input: {
  req: Request;
  res: Response;
  upstreamUrl: string;
  mediaId: number;
  userId: number;
  sessionId: number;
  expiresAtEpochSeconds: number;
}) {
  const response = await fetchAdaptiveUpstream(input.upstreamUrl, input.req.headers.range);
  if (!response.ok && response.status !== 206) {
    throw new Error(`Adaptive upstream returned ${response.status}`);
  }

  setProtectedMediaHeaders(input.res);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isManifest =
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    input.upstreamUrl.toLowerCase().split("?")[0].endsWith(".m3u8");

  if (isManifest) {
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MANIFEST_MAX_BYTES) throw new Error("Adaptive manifest is too large");
    const manifest = await response.text();
    if (Buffer.byteLength(manifest, "utf8") > MANIFEST_MAX_BYTES) {
      throw new Error("Adaptive manifest is too large");
    }
    const rewritten = rewriteHlsManifest({
      manifest,
      upstreamManifestUrl: input.upstreamUrl,
      mediaId: input.mediaId,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAtEpochSeconds: input.expiresAtEpochSeconds,
    });
    input.res.status(200);
    input.res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    return input.res.send(rewritten);
  }

  const safeContentType = response.headers.get("content-type");
  const contentLength = response.headers.get("content-length");
  const contentRange = response.headers.get("content-range");
  const acceptRanges = response.headers.get("accept-ranges");
  if (safeContentType) input.res.setHeader("Content-Type", safeContentType);
  if (contentLength) input.res.setHeader("Content-Length", contentLength);
  if (contentRange) input.res.setHeader("Content-Range", contentRange);
  if (acceptRanges) input.res.setHeader("Accept-Ranges", acceptRanges);
  input.res.status(response.status);

  if (!response.body) return input.res.end();
  const stream = Readable.fromWeb(response.body as any);
  stream.on("error", () => {
    if (!input.res.headersSent) input.res.status(502).end();
    else input.res.end();
  });
  return stream.pipe(input.res);
}
