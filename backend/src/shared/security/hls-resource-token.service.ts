import crypto from "crypto";
import { getMediaConfig } from "../../config/media.config";
import { MediaInvalidTokenException } from "../exceptions/media.exception";

const PURPOSE = "hls-resource";
const VERSION = 1;

export type HlsResourceTokenPayload = {
  mediaId: number;
  userId: number;
  sessionId: number;
  upstreamUrl: string;
  exp: number;
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function encryptionKey() {
  const secret = getMediaConfig().mediaSignedTokenSecret;
  return crypto.createHash("sha256").update(`phase09a:${secret}`, "utf8").digest();
}

function assertCloudinaryHttpsUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new MediaInvalidTokenException("Invalid adaptive media resource");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com") {
    throw new MediaInvalidTokenException("Adaptive media resource host is not allowed");
  }
  return parsed.toString();
}

export function createHlsResourceToken(input: {
  mediaId: number;
  userId: number;
  sessionId: number;
  upstreamUrl: string;
  expiresAtEpochSeconds: number;
}): string {
  const mediaId = positiveInteger(input.mediaId);
  const userId = positiveInteger(input.userId);
  const sessionId = positiveInteger(input.sessionId);
  const exp = Number(input.expiresAtEpochSeconds);
  if (!mediaId || !userId || !sessionId || !Number.isSafeInteger(exp)) {
    throw new MediaInvalidTokenException("Invalid adaptive media token subject");
  }
  if (exp <= Math.floor(Date.now() / 1000)) {
    throw new MediaInvalidTokenException("Adaptive media token expiry is invalid");
  }

  const payload = JSON.stringify({
    v: VERSION,
    purpose: PURPOSE,
    mediaId,
    userId,
    sessionId,
    upstreamUrl: assertCloudinaryHttpsUrl(input.upstreamUrl),
    exp,
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function verifyHlsResourceToken(token: string): HlsResourceTokenPayload {
  try {
    const packed = Buffer.from(String(token || ""), "base64url");
    if (packed.length < 12 + 16 + 1) throw new Error("short token");
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const decoded = JSON.parse(plaintext) as Record<string, unknown>;

    const mediaId = positiveInteger(decoded.mediaId);
    const userId = positiveInteger(decoded.userId);
    const sessionId = positiveInteger(decoded.sessionId);
    const exp = Number(decoded.exp);
    if (
      decoded.v !== VERSION ||
      decoded.purpose !== PURPOSE ||
      !mediaId ||
      !userId ||
      !sessionId ||
      !Number.isSafeInteger(exp)
    ) {
      throw new Error("invalid payload");
    }
    if (exp <= Math.floor(Date.now() / 1000)) {
      throw new MediaInvalidTokenException("Adaptive media token expired");
    }

    return {
      mediaId,
      userId,
      sessionId,
      upstreamUrl: assertCloudinaryHttpsUrl(String(decoded.upstreamUrl || "")),
      exp,
    };
  } catch (error) {
    if (error instanceof MediaInvalidTokenException) throw error;
    throw new MediaInvalidTokenException("Invalid adaptive media token");
  }
}
