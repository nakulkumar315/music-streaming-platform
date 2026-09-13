import { apiV1 } from './api';
import logger from '../utils/logger';

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let currentSessionId: number | null = null;
let currentContentId: string | null = null;

/**
 * Start sending heartbeats for one exact server playback lease.
 * The backend requires both sessionId and contentId; sending only contentId
 * cannot renew the lease and eventually invalidates the signed playback token.
 */
export function startHeartbeat(
  sessionId: number,
  contentId: string,
  getPosition?: () => number,
  getDuration?: () => number
) {
  stopHeartbeat(); // Clear any existing heartbeat

  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    logger.warn('[Heartbeat] Refusing to start without a valid playback session');
    return;
  }

  currentSessionId = sessionId;
  currentContentId = contentId;

  // Send an immediate heartbeat right when playback starts.
  const sendBeat = async () => {
    try {
      const currentPosition = getPosition ? getPosition() : 0;
      const duration = getDuration ? getDuration() : 0;

      const response = await apiV1.post('/stream/heartbeat', {
        sessionId,
        contentId: Number(contentId),
        currentPosition: Math.round(currentPosition),
        duration: Math.round(duration),
      });
      if (!response.data.success) {
        logger.warn('[Heartbeat] Failed to send heartbeat:', response.data.message);
      }
    } catch (error: any) {
      logger.error(
        '[Heartbeat] Error sending heartbeat:',
        error?.response?.data?.code || error?.response?.status || error?.message
      );
    }
  };

  void sendBeat();

  // Then every 30 seconds; comfortably inside the five-minute server lease.
  heartbeatInterval = setInterval(() => {
    void sendBeat();
  }, 30000);

  logger.log('[Heartbeat] Started', { sessionId, contentId });
}

/** Stop sending heartbeats for the local active lease. */
export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (currentSessionId !== null || currentContentId !== null) {
    logger.log('[Heartbeat] Stopped');
  }
  currentSessionId = null;
  currentContentId = null;
}

/** Check if heartbeat is currently active. */
export function isHeartbeatActive(): boolean {
  return heartbeatInterval !== null;
}
