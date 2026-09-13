import {
  MediaAccessDeniedException,
  MediaExpiredAccessException,
  MediaInvalidTokenException,
  MediaNotFoundException,
  MediaNotReadyException
} from "../../shared/exceptions/media.exception";
import {
  DeliveryFailedException,
  DeliveryStrategyNotAvailableException
} from "../../shared/exceptions/delivery.exception";

export interface StreamAccessErrorPayload {
  status: number;
  code: string;
  message: string;
}

export function mapStreamAccessError(err: unknown): StreamAccessErrorPayload {
  if (err instanceof MediaNotFoundException) {
    return { status: 404, code: "CONTENT_NOT_FOUND", message: "Content not found" };
  }
  if (err instanceof MediaNotReadyException) {
    if (String(err.status || "").toUpperCase() === "TAKEN_DOWN") {
      return {
        status: 410,
        code: "CONTENT_TAKEN_DOWN",
        message: "This content is no longer available"
      };
    }
    return { status: 409, code: "CONTENT_NOT_READY", message: err.message };
  }
  if (err instanceof MediaAccessDeniedException) {
    const status =
      err.code === "AUTHENTICATION_REQUIRED"
        ? 401
        : err.code === "PLAYBACK_SESSION_LIMIT"
          ? 429
          : 403;
    return { status, code: err.code, message: err.message };
  }
  if (err instanceof MediaExpiredAccessException) {
    return { status: 401, code: "PLAYBACK_ACCESS_EXPIRED", message: err.message };
  }
  if (err instanceof MediaInvalidTokenException) {
    return { status: 401, code: "INVALID_PLAYBACK_TOKEN", message: err.message };
  }
  if (err instanceof DeliveryStrategyNotAvailableException) {
    return {
      status: 503,
      code: "DELIVERY_PROVIDER_UNAVAILABLE",
      message: "Playback provider is unavailable for this media"
    };
  }
  if (err instanceof DeliveryFailedException) {
    return {
      status: 502,
      code: "PLAYBACK_URL_GENERATION_FAILED",
      message: err.message || "Failed to generate playback URL"
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Failed to get playback access"
  };
}

