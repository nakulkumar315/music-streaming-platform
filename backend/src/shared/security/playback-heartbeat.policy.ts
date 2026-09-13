export const HEARTBEAT_MIN_SERVER_DELTA_SECONDS = 2;
export const HEARTBEAT_MAX_ACCEPTED_INCREMENT_SECONDS = 45;
export const HEARTBEAT_MAX_GAP_SECONDS = 90;

export type HeartbeatAcceptanceInput = {
  sequence: number;
  previousSequence: number;
  currentPosition: number;
  lastAcceptedPosition: number;
  serverElapsedSeconds: number | null;
};

export type HeartbeatAcceptance = {
  duplicateOrReplay: boolean;
  acceptedSeconds: number;
  acceptedPosition: number;
  reason:
    | "FIRST_HEARTBEAT"
    | "DUPLICATE_OR_REPLAY"
    | "TOO_FREQUENT"
    | "TOO_LATE"
    | "BACKWARD_OR_STALLED"
    | "ACCEPTED";
};

function safeNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function calculateHeartbeatAcceptance(
  input: HeartbeatAcceptanceInput
): HeartbeatAcceptance {
  const sequence = safeNonNegativeInteger(input.sequence);
  const previousSequence = safeNonNegativeInteger(input.previousSequence);
  const currentPosition = safeNonNegativeInteger(input.currentPosition);
  const lastAcceptedPosition = safeNonNegativeInteger(input.lastAcceptedPosition);

  if (
    sequence === null ||
    previousSequence === null ||
    currentPosition === null ||
    lastAcceptedPosition === null
  ) {
    throw new Error("Heartbeat acceptance requires non-negative safe integers");
  }

  if (sequence <= previousSequence) {
    return {
      duplicateOrReplay: true,
      acceptedSeconds: 0,
      acceptedPosition: lastAcceptedPosition,
      reason: "DUPLICATE_OR_REPLAY",
    };
  }

  const elapsed = input.serverElapsedSeconds;
  if (elapsed === null) {
    return {
      duplicateOrReplay: false,
      acceptedSeconds: 0,
      acceptedPosition: Math.max(lastAcceptedPosition, currentPosition),
      reason: "FIRST_HEARTBEAT",
    };
  }

  const serverElapsedSeconds = Math.max(0, Math.floor(elapsed));
  if (serverElapsedSeconds < HEARTBEAT_MIN_SERVER_DELTA_SECONDS) {
    return {
      duplicateOrReplay: false,
      acceptedSeconds: 0,
      acceptedPosition: Math.max(lastAcceptedPosition, currentPosition),
      reason: "TOO_FREQUENT",
    };
  }

  if (serverElapsedSeconds > HEARTBEAT_MAX_GAP_SECONDS) {
    return {
      duplicateOrReplay: false,
      acceptedSeconds: 0,
      acceptedPosition: Math.max(lastAcceptedPosition, currentPosition),
      reason: "TOO_LATE",
    };
  }

  const positionDelta = currentPosition - lastAcceptedPosition;
  if (positionDelta <= 0) {
    return {
      duplicateOrReplay: false,
      acceptedSeconds: 0,
      acceptedPosition: lastAcceptedPosition,
      reason: "BACKWARD_OR_STALLED",
    };
  }

  // The client position is useful only as an upper bound. Trusted listening
  // time can never exceed elapsed server wall-clock time or one heartbeat cap.
  const acceptedSeconds = Math.min(
    positionDelta,
    serverElapsedSeconds,
    HEARTBEAT_MAX_ACCEPTED_INCREMENT_SECONDS
  );

  return {
    duplicateOrReplay: false,
    acceptedSeconds,
    acceptedPosition: currentPosition,
    reason: "ACCEPTED",
  };
}
