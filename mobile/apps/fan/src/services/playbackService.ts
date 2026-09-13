import TrackPlayer, { Event, State } from 'react-native-track-player';
import { Platform } from 'react-native';
import logger from '../utils/logger';

// Only resume after a temporary interruption when this service itself paused a
// track that had actually been playing. Never auto-resume user-paused audio.
let resumeAfterTemporaryDuck = false;

/**
 * Background Playback Service
 *
 * Handles remote media controls from notification, lock screen and control
 * center. Product/player state remains authoritative in the foreground app.
 *
 * Next/previous are intentionally not exposed here. The application queue is
 * currently owned by React state and is not synchronized into TrackPlayer's
 * native queue, so advertising those actions while JS is suspended would be
 * misleading and unreliable.
 */
export default async function playbackService() {
  logger.log('[PlaybackService] Starting background playback service');

  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    try {
      const state = await TrackPlayer.getState();
      if (state !== State.Playing) await TrackPlayer.play();
    } catch (error) {
      logger.error('[PlaybackService] RemotePlay error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    try {
      const state = await TrackPlayer.getState();
      if (state === State.Playing) await TrackPlayer.pause();
      resumeAfterTemporaryDuck = false;
    } catch (error) {
      logger.error('[PlaybackService] RemotePause error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    try {
      resumeAfterTemporaryDuck = false;
      await TrackPlayer.reset();
    } catch (error) {
      logger.error('[PlaybackService] RemoteStop error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
    try {
      await TrackPlayer.seekTo(event.position);
    } catch (error) {
      logger.error('[PlaybackService] RemoteSeek error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
    try {
      const progress = await TrackPlayer.getProgress();
      const jumpAmount = event.interval || 10;
      const newPosition = Math.min(progress.position + jumpAmount, progress.duration);
      await TrackPlayer.seekTo(newPosition);
    } catch (error) {
      logger.error('[PlaybackService] RemoteJumpForward error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
    try {
      const progress = await TrackPlayer.getProgress();
      const jumpAmount = event.interval || 10;
      await TrackPlayer.seekTo(Math.max(0, progress.position - jumpAmount));
    } catch (error) {
      logger.error('[PlaybackService] RemoteJumpBackward error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    try {
      if (event.permanent) {
        resumeAfterTemporaryDuck = false;
        await TrackPlayer.pause();
        return;
      }

      if (event.paused) {
        const state = await TrackPlayer.getState();
        resumeAfterTemporaryDuck = state === State.Playing;
        if (resumeAfterTemporaryDuck) await TrackPlayer.pause();
        return;
      }

      if (resumeAfterTemporaryDuck) {
        resumeAfterTemporaryDuck = false;
        await TrackPlayer.play();
      }
    } catch (error) {
      resumeAfterTemporaryDuck = false;
      logger.error('[PlaybackService] RemoteDuck error:', error);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackState, async (state) => {
    logger.log('[PlaybackService] PlaybackState changed:', state.state);
  });

  TrackPlayer.addEventListener(Event.PlaybackTrackChanged, async (event) => {
    logger.log('[PlaybackService] PlaybackTrackChanged:', {
      track: event.track,
      position: event.position,
      nextTrack: event.nextTrack,
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (event) => {
    logger.log('[PlaybackService] PlaybackQueueEnded:', event);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async (error) => {
    logger.error('[PlaybackService] PlaybackError:', error);
    resumeAfterTemporaryDuck = false;
    try {
      await TrackPlayer.pause();
    } catch {
      // Best-effort recovery only.
    }
  });

  if (Platform.OS === 'ios') {
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
      logger.log('[PlaybackService] PlaybackActiveTrackChanged:', event);
    });
  }

  logger.log('[PlaybackService] Background playback service initialized');
}
