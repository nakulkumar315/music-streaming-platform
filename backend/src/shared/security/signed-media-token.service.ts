/**
 * Short-lived, session-bound media tokens.
 */

import jwt from "jsonwebtoken";
import { getMediaConfig } from "../../config/media.config";
import { MediaInvalidTokenException } from "../exceptions/media.exception";

const PURPOSE_PLAYBACK = "playback";

export interface SignedMediaTokenPayload {
  mediaId: number;
  userId: number;
  sessionId: number;
  purpose: string;
  exp: number;
  iat: number;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createPlaybackToken(
  mediaId: number,
  userId: number,
  sessionId: number,
  expiresInSeconds: number
): string {
  const validMediaId = positiveInteger(mediaId);
  const validUserId = positiveInteger(userId);
  const validSessionId = positiveInteger(sessionId);
  if (!validMediaId || !validUserId || !validSessionId) {
    throw new MediaInvalidTokenException("Invalid playback token subject");
  }

  const config = getMediaConfig();
  return jwt.sign(
    {
      mediaId: validMediaId,
      userId: validUserId,
      sessionId: validSessionId,
      purpose: PURPOSE_PLAYBACK,
    },
    config.mediaSignedTokenSecret,
    { expiresIn: expiresInSeconds }
  );
}

export function verifyPlaybackToken(token: string): SignedMediaTokenPayload {
  const config = getMediaConfig();
  try {
    const decoded = jwt.verify(token, config.mediaSignedTokenSecret) as any;
    const mediaId = positiveInteger(decoded?.mediaId);
    const userId = positiveInteger(decoded?.userId);
    const sessionId = positiveInteger(decoded?.sessionId);

    if (
      decoded?.purpose !== PURPOSE_PLAYBACK ||
      !mediaId ||
      !userId ||
      !sessionId ||
      !Number.isFinite(Number(decoded?.exp)) ||
      !Number.isFinite(Number(decoded?.iat))
    ) {
      throw new MediaInvalidTokenException("Invalid token payload");
    }

    return {
      mediaId,
      userId,
      sessionId,
      purpose: PURPOSE_PLAYBACK,
      exp: Number(decoded.exp),
      iat: Number(decoded.iat),
    };
  } catch (error: any) {
    if (error instanceof MediaInvalidTokenException) throw error;
    if (error?.name === "TokenExpiredError") {
      throw new MediaInvalidTokenException("Playback token expired");
    }
    throw new MediaInvalidTokenException("Invalid playback token");
  }
}
