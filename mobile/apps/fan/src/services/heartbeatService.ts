import { apiV1 } from './api';
import {
  ensureActivePlaybackLease,
  markActivePlaybackLeaseAlive,
  reacquireExpiredPlaybackLease,
} from './streamService';
import logger from '../utils/logger';

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let currentContentId: string | null = null;
let heartbeatSessionId: number | null = null;
let heartbeatSequence = 0;
let heartbeatInFlight = false;

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

function isExpiredSessionError(error: any) {
  const code = String(error?.response?.data?.code || error?.code || '');
  return code === 'PLAYBACK_SESSION_EXPIRED' || code === 'PLAYBACK_SESSION_MISMATCH';
}

function shouldStopHeartbeatForAuthorization(error: any) {
  const status = Number(error?.response?.status || error?.status || 0);
  const code = String(error?.response?.data?.code || error?.code || '');
  return (
    status === 401 ||
    status === 403 ||
    code === 'PLAYBACK_SESSION_REVOKED' ||
    code === 'SUBSCRIPTION_REQUIRED' ||
    code === 'SUBSCRIPTION_EXPIRED' ||
    code === 'SUBSCRIPTION_INACTIVE' ||
    code === 'CONTENT_TAKEN_DOWN' ||
    code === 'CONTENT_NOT_READY'
  );
}

/**
 * Start sending heartbeats for the exact server playback lease currently owned
 * by the global player. The lease is revalidated/reacquired when local freshness
 * shows it may have expired during a long pause/background interval.
 */
export function startHeartbeat(
  contentId: string,
  getPosition?: () => number,
  getDuration?: () => number
) {
  // Multiple lifecycle surfaces may observe the same playing transition. Keep
  // one timer per content instead of resetting the timer/sequence twice.
  if (heartbeatInterval && currentContentId === contentId) return;

  stopHeartbeat();
  currentContentId = contentId;

  const postForLease = async (lease: { sessionId: number }) => {
    const sequence = nextHeartbeatSequence(lease.sessionId);
    if (!sequence) {
      throw new Error('Invalid playback lease session id');
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

    if (response.data?.success) {
      markActivePlaybackLeaseAlive(lease.sessionId);
    }
    return response;
  };

  const sendBeat = async () => {
    if (heartbeatInFlight || currentContentId !== contentId) return;
    heartbeatInFlight = true;

    try {
      const lease = await ensureActivePlaybackLease(contentId);
      if (currentContentId !== contentId) return;

      try {
        const response = await postForLease(lease);
        if (!response.data?.success) {
          logger.warn('[Heartbeat] Failed to send heartbeat:', response.data?.message);
        }
      } catch (error: any) {
        // A long pause/background interval can cross the five-minute server
        // lease window between local checks. Recover once by explicitly creating
        // a fresh same-content lease, then establish its baseline heartbeat.
        if (isExpiredSessionError(error) && currentContentId === contentId) {
          const recovered = await reacquireExpiredPlaybackLease(contentId);
          if (currentContentId !== contentId) return;
          await postForLease(recovered);
          return;
        }
        throw error;
      }
    } catch (error: any) {
      if (shouldStopHeartbeatForAuthorization(error)) {
        // Do not keep retrying a lease after current authorization has been
        // revoked. Playback source TTL remains the final media-delivery bound.
        stopHeartbeat();
      }
      logger.error(
        '[Heartbeat] Error sending heartbeat:',
        error?.response?.data?.code || error?.response?.status || error?.code || error?.message
      );
    } finally {
      heartbeatInFlight = false;
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
