/**
 * Media-layer exceptions. Section 28.
 */

export type MediaAccessDeniedCode =
  | "ACCESS_DENIED"
  | "AUTHENTICATION_REQUIRED"
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_INACTIVE"
  | "CONTENT_INTERNAL"
  | "CONTENT_TAKEN_DOWN"
  | "INVALID_VISIBILITY"
  | "PLAYBACK_SESSION_LIMIT";

export class MediaNotFoundException extends Error {
  constructor(public readonly mediaId: number | string) {
    super(`Media not found: ${mediaId}`);
    this.name = "MediaNotFoundException";
  }
}

export class MediaNotReadyException extends Error {
  constructor(
    public readonly mediaId: number | string,
    public readonly status?: string
  ) {
    super(`Media not ready for playback: ${mediaId}${status ? ` (status: ${status})` : ""}`);
    this.name = "MediaNotReadyException";
  }
}

export class MediaAccessDeniedException extends Error {
  constructor(
    message = "Access denied to this media",
    public readonly code: MediaAccessDeniedCode = "ACCESS_DENIED"
  ) {
    super(message);
    this.name = "MediaAccessDeniedException";
  }
}

export class MediaExpiredAccessException extends Error {
  constructor(message = "Playback access has expired") {
    super(message);
    this.name = "MediaExpiredAccessException";
  }
}

export class MediaInvalidTokenException extends Error {
  constructor(message = "Invalid or expired playback token") {
    super(message);
    this.name = "MediaInvalidTokenException";
  }
}
