import { apiV1 } from './api';
import { getActivePlaybackLease } from './streamService';
import logger from '../utils/logger';

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let currentContentId: string | null = null;
let heartbeatSessionId: number | null = null;
let heartbeatSequence = 0;

/**
 * Keep the sequence monotonic for the lifetime of one server playback session.
 * Pausing stops the timer but deliberately keeps the lease alive, so restarting
 * heartbeats for that same lease must continue from the previous sequence rather
 * than replaying 1..N. A newly allocated server session gets its own sequence.
 */
function nextHeartbeatSequence(rawSessionId: unknown): number | null {
  const sessionId = Number(rawSessionId);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;

  if (heartbeatSessionId !== sessionId) {
    heartbeatSessionId = sessionId;
    heartbeatSequence = 0;
  }

  heartbeatSequence += 1;
  return heartbeatSequence;
}

/**
 * Start sending heartbeats for the exact server playback lease currently owned
 * by the global player. The lease id is resolved from streamService so token
 * refresh can rotate URLs without allocating or heartbeating a different slot.
 */
export function startHeartbeat(
  contentId: string,
  getPosition?: () => number,
  getDuration?: () => number
) {
  stopHeartbeat();
  currentContentId = contentId;

  const sendBeat = async () => {
    try {
      const lease = getActivePlaybackLease(contentId);
      if (!lease) {
        logger.warn('[Heartbeat] No active playback lease for content:', contentId);
        return;
      }

      const sequence = nextHeartbeatSequence(lease.sessionId);
      if (!sequence) {
        logger.warn('[Heartbeat] Invalid playback lease session id');
        return;
      }

      const currentPosition = getPosition ? getPosition() : 0;
      const duration = getDuration ? getDuration() : 0;

      const response = await apiV1.post('/stream/heartbeat', {
        sessionId: lease.sessionId,
        contentId: Number(contentId),
        sequence,
        currentPosition: Math.max(0, Math.round(currentPosition)),
        duration: Math.max(0, Math.round(duration)),
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

  // Fire immediately once the player enters playing state, then remain well
  // inside the backend's five-minute lease window. The immediate beat establishes
  // server timing context but does not itself manufacture listening time.
  void sendBeat();
  heartbeatInterval = setInterval(() => {
    void sendBeat();
  }, 30000);

  logger.log('[Heartbeat] Started for content:', contentId);
}

/**
 * Stop only the heartbeat timer. Pausing does not terminate the server lease,
 * therefore the per-session sequence is intentionally retained until a
 * different server playback session is observed.
 */
export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (currentContentId !== null) {
    logger.log('[Heartbeat] Stopped');
  }
  currentContentId = null;
}

/** Check if heartbeat is currently active. */
export function isHeartbeatActive(): boolean {
  return heartbeatInterval !== null;
}
