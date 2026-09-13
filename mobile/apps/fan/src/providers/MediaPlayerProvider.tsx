import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AppState, Platform } from "react-native";

import { createVideoPlayer, VideoPlayer } from "expo-video";

import logger from "../utils/logger";

// Try to import TrackPlayer, fallback for Expo Go compatibility
let TrackPlayer: any = null;
let TrackPlayerState: any = null;
let Event: any = null;
let Capability: any = null;
let AppKilledPlaybackBehavior: any = null;
let RepeatMode: any = null;
let PitchAlgorithm: any = null;
let TrackPlayerAvailable = false;

try {
  const TrackPlayerModule = require("react-native-track-player");
  TrackPlayer = TrackPlayerModule.default;
  TrackPlayerState = TrackPlayerModule.State;
  Event = TrackPlayerModule.Event;
  Capability = TrackPlayerModule.Capability;
  AppKilledPlaybackBehavior = TrackPlayerModule.AppKilledPlaybackBehavior;
  RepeatMode = TrackPlayerModule.RepeatMode;
  PitchAlgorithm = TrackPlayerModule.PitchAlgorithm;
  TrackPlayerAvailable = true;
} catch (e) {
  logger.warn(
    "TrackPlayer not available, running in Expo Go without background audio playback"
  );
}

// Type for Track when module is available
type Track = any;

import { startHeartbeat, stopHeartbeat } from "../services/heartbeatService";
import { recordPlayback } from "../services/libraryService";
import {
  getPlaybackErrorPresentation,
  getPlaybackUrl,
  normalizePlaybackUrl,
  validatePlaybackUrl,
  type VideoQuality,
} from "../services/streamService";
import { decodeJwtExpMsFromUrl } from "../utils/streaming";

import type { MediaItem, PlayerState } from "../media.types";

// Removed SoundLike type as it is no longer needed with expo-audio

type MediaPlayerContextValue = {
  state: PlayerState;
  currentItem: MediaItem | null;
  playQueue: (queue: MediaItem[], index: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrev: () => Promise<void>;
  setShuffle: (enabled: boolean) => void;
  toggleShuffle: () => void;
  setRepeatMode: (mode: PlayerState["repeatMode"]) => void;
  cycleRepeatMode: () => void;
  setPlaybackRate: (rate: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  close: () => Promise<void>;
  videoAudioOnlyMode: boolean;
  videoRestoreNonce: number;
  videoRestorePositionMs: number;

  inlineVideoHostActive: boolean;
  setInlineVideoHostActive: (active: boolean) => void;

  inlineAudioHostActive: boolean;
  setInlineAudioHostActive: (active: boolean) => void;

  videoPlayer: VideoPlayer | null;
  audioPlayer: null;
  isPlayerReady: boolean;
  onVideoPlaybackStatusUpdate: (status: any) => void;

  preferredQuality: VideoQuality;
  setPreferredQuality: (q: VideoQuality) => void;
  setExpanded: (expanded: boolean) => void;
};

const MediaPlayerContext = createContext<MediaPlayerContextValue | undefined>(
  undefined
);

const EMPTY_STATE: PlayerState = {
  queue: [],
  currentIndex: 0,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isExpanded: false,
  isShuffle: false,
  repeatMode: "off",
  playbackRate: 1,
  volume: 1,
};

export function useMediaPlayer() {
  const ctx = useContext(MediaPlayerContext);
  if (!ctx)
    throw new Error("useMediaPlayer must be used within a MediaPlayerProvider");
  return ctx;
}

export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>(EMPTY_STATE);

  const IOS_INTERRUPTION_DO_NOT_MIX = 1;
  const ANDROID_INTERRUPTION_DUCK_OTHERS = 1;

  const [videoAudioOnlyMode, setVideoAudioOnlyMode] = useState(false);
  const [videoRestoreNonce, setVideoRestoreNonce] = useState(0);
  const videoRestorePositionMsRef = useRef(0);

  const [inlineVideoHostActive, setInlineVideoHostActive] = useState(false);
  const [inlineAudioHostActive, setInlineAudioHostActive] = useState(false);

  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const audioPlayer = null;
  const [audioSource, setAudioSource] = useState<string | null>(null);

  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [videoPlayer, setVideoPlayer] = useState<VideoPlayer | null>(null);

  // Lazy initialization of VideoPlayer to avoid "Activity not available" crash at startup
  useEffect(() => {
    let isMounted = true;

    // Defer creation to the first effect run (after initial render/mount)
    // this ensures the Android Activity is ready for the native module.
    try {
      logger.log("[MediaPlayer] Initializing VideoPlayer lazily...");
      const player = createVideoPlayer(videoSource);

      // Configure background playback capabilities
      player.showNowPlayingNotification = true;
      player.staysActiveInBackground = true;
      player.timeUpdateEventInterval = 0.1; // 100ms updates for smooth seekbar

      if (isMounted) {
        setVideoPlayer(player);
        logger.log("[MediaPlayer] VideoPlayer initialized successfully");
      }
    } catch (e) {
      logger.error(
        "[MediaPlayer] Failed to create VideoPlayer in useEffect",
        e
      );
    }

    return () => {
      isMounted = false;
      // Note: VideoPlayer will be cleaned up by native garbage collection
      // or we could explicitly null it if needed in future versions.
    };
  }, []); // Run only once on mount

  // Keep player in sync with source changes
  useEffect(() => {
    if (videoPlayer && videoSource) {
      try {
        videoPlayer.replace(videoSource);
        // Reset state for new source
        setState((s) => ({ ...s, positionMs: 0, durationMs: 0 }));
      } catch (e) {
        logger.warn("[MediaPlayer] Failed to replace video source", e);
      }
    }
  }, [videoSource, videoPlayer]);

  // Sync video player native events to context state
  useEffect(() => {
    if (!videoPlayer) return;

    logger.log("[MediaPlayer] Attaching VideoPlayer event listeners");

    const playingSub = videoPlayer.addListener("playingChange", (event) => {
      setState((s) => ({ ...s, isPlaying: event.isPlaying }));
    });

    const timeSub = videoPlayer.addListener("timeUpdate", (event) => {
      const pos = Math.round(event.currentTime * 1000);
      setState((s) => {
        // Only update if difference is significant or it's a state change
        // this helps reduce unnecessary re-renders while keeping 100ms smoothness.
        if (Math.abs(s.positionMs - pos) < 50 && s.isPlaying) return s;
        return { ...s, positionMs: pos };
      });
    });

    const sourceSub = videoPlayer.addListener("sourceLoad", (event) => {
      if (event.duration > 0) {
        setState((s) => ({
          ...s,
          durationMs: Math.round(event.duration * 1000),
        }));
      }
    });

    return () => {
      playingSub.remove();
      timeSub.remove();
      sourceSub.remove();
    };
  }, [videoPlayer]);

  const [preferredQuality, setPreferredQuality] =
    useState<VideoQuality>("Auto");

  const audioLoadTokenRef = useRef(0);
  const hasStartedPlayingRef = useRef(false);

  const currentItem = state.queue.length
    ? state.queue[state.currentIndex] ?? null
    : null;

  const lastVideoContentKeyRef = useRef<string | null>(null);

  const playbackRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastRecordedRef = useRef<string | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const preloadedUrlRef = useRef<{ id: string; url: string } | null>(null);

  const stateRef = useRef<PlayerState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    // Skip TrackPlayer setup if not available (Expo Go compatibility)
    if (!TrackPlayerAvailable) {
      setIsPlayerReady(true); // Mark as ready even without TrackPlayer
      logger.log(
        "[MediaPlayer] TrackPlayer not available, audio playback disabled in Expo Go"
      );
      return;
    }

    let unmounted = false;
    const setup = async () => {
      let isSetup = false;
      try {
        await TrackPlayer.getActiveTrackIndex();
        isSetup = true;
      } catch {
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true,
          autoUpdateMetadata: true,
        });
        isSetup = true;
      }

      if (isSetup) {
        await TrackPlayer.updateOptions({
          android: {
            appKilledPlaybackBehavior:
              AppKilledPlaybackBehavior?.StopPlaybackAndRemoveNotification,
            alwaysPauseOnInterruption: false,
            // Keep notification visible when paused
            stopForegroundGracePeriod: 0,
          },
          // Main capabilities shown in notification/lock screen
          capabilities: [
            Capability?.Play,
            Capability?.Pause,
            Capability?.SkipToNext,
            Capability?.SkipToPrevious,
            Capability?.SeekTo,
            Capability?.JumpForward,
            Capability?.JumpBackward,
            Capability?.Stop,
          ],
          // Compact capabilities (small notification view)
          compactCapabilities: [
            Capability?.Play,
            Capability?.Pause,
            Capability?.SkipToNext,
          ],
          // Notification icon customization
          notificationCapabilities: [
            Capability?.Play,
            Capability?.Pause,
            Capability?.SkipToNext,
            Capability?.SkipToPrevious,
            Capability?.SeekTo,
            Capability?.Stop,
          ],
          // Progress bar on notification
          progressUpdateEventInterval: 1,
        });
        if (!unmounted) setIsPlayerReady(true);
        logger.log(
          "[MediaPlayer] TrackPlayer setup complete with background capabilities"
        );
      }
    };
    setup();
    return () => {
      unmounted = true;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      logger.log("App state changed to:", next);
      const item = currentItemRef.current;
      const s = stateRef.current;

      if (next !== "active") {
        if (item?.mediaType === "video" && s.isPlaying) {
          // Do NOT pause. Keep playback going, but mark UI as audio-only.
          videoRestorePositionMsRef.current = s.positionMs;
          setVideoAudioOnlyMode(true);
          // setAudioModeAsync removed for TrackPlayer

          // iOS can briefly pause the playback object during the transition; force resume.
          (async () => {
            if (!videoPlayer) return;
            try {
              videoPlayer.volume = 1.0;
            } catch {
              // ignore
            }
            try {
              videoPlayer.play();
            } catch {
              // ignore
            }
          })().catch(() => undefined);
        }
        return;
      }

      // Back to active: re-show video and ask consumers to restore position.
      if (videoAudioOnlyMode) {
        setVideoAudioOnlyMode(false);
        setVideoRestoreNonce((n) => n + 1);

        // Best-effort: keep volume at 1.0 and re-assert play if we were playing.
        if (s.isPlaying) {
          (async () => {
            if (!videoPlayer) return;
            try {
              videoPlayer.volume = 1.0;
            } catch {
              // ignore
            }
            try {
              videoPlayer.play();
            } catch {
              // ignore
            }
          })().catch(() => undefined);
        }
      }
    });

    return () => {
      sub.remove();
    };
  }, [videoAudioOnlyMode]);

  useEffect(() => {
    if (!currentItem?.id) return;
    if (!state.isPlaying) {
      stopHeartbeat();
      return;
    }

    const key = `${currentItem.contentId ?? currentItem.id}`;

    // avoid multiple immediate calls when state updates rapidly
    if (lastRecordedRef.current === key) return;

    if (playbackRecordTimerRef.current) {
      clearTimeout(playbackRecordTimerRef.current);
      playbackRecordTimerRef.current = null;
    }

    playbackRecordTimerRef.current = setTimeout(() => {
      lastRecordedRef.current = key;
      recordPlayback(key).catch(() => undefined);
    }, 500);

    // Start heartbeat for listening time tracking
    startHeartbeat(
      key,
      () => stateRef.current.positionMs,
      () => stateRef.current.durationMs
    );

    return () => {
      if (playbackRecordTimerRef.current) {
        clearTimeout(playbackRecordTimerRef.current);
        playbackRecordTimerRef.current = null;
      }
    };
  }, [currentItem?.id, state.isPlaying]);

  const currentItemRef = useRef<MediaItem | null>(currentItem);
  useEffect(() => {
    currentItemRef.current = currentItem;
  }, [currentItem]);

  useEffect(() => {
    const item = currentItem;
    if (!item) return;
    if (item.mediaType !== "video") return;

    const key = String(item.contentId ?? item.id);
    if (lastVideoContentKeyRef.current === key) return;
    lastVideoContentKeyRef.current = key;

    // Ensure a new video never inherits the previous video's position.
    setState((s) => ({
      ...s,
      positionMs: 0,
    }));

    // Video ref may not be mounted/loaded yet; best-effort seek after a tick.
    const t = setTimeout(() => {
      videoPlayer?.seekBy(-videoPlayer.currentTime);
    }, 0);

    return () => {
      clearTimeout(t);
    };
  }, [currentItem]);

  const applyPlaybackConfigToCurrent = useCallback(async () => {
    const s = stateRef.current;
    const item = currentItemRef.current;
    if (!item) return;

    if (item.mediaType === "audio" && TrackPlayerAvailable) {
      try {
        TrackPlayer.setRate(s.playbackRate);
      } catch {
        // ignore
      }
      try {
        TrackPlayer.setVolume(s.volume);
      } catch {
        // ignore
      }
      return;
    }

    if (!videoPlayer) return;
    try {
      videoPlayer.playbackRate = s.playbackRate;
    } catch {
      // ignore
    }
    try {
      videoPlayer.volume = s.volume;
    } catch {
      // ignore
    }
  }, []);

  const shuffleQueueKeepCurrent = useCallback(
    (queue: MediaItem[], currentIndex: number) => {
      if (queue.length <= 1) return { queue, currentIndex };
      const current = queue[currentIndex];
      const rest = queue.filter((_, idx) => idx !== currentIndex);
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = rest[i];
        rest[i] = rest[j];
        rest[j] = tmp;
      }
      return { queue: [current, ...rest], currentIndex: 0 };
    },
    []
  );

  const handleDidJustFinish = useCallback(async () => {
    const s = stateRef.current;
    const item = currentItemRef.current;
    if (!item) return;

    if (s.repeatMode === "one") {
      try {
        if (item.mediaType === "audio" && TrackPlayerAvailable) {
          TrackPlayer.seekTo(0);
          TrackPlayer.play();
        } else if (videoPlayer) {
          videoPlayer.seekBy(-videoPlayer.currentTime);
          videoPlayer.play();
        }
      } catch {
        // ignore
      }
      return;
    }

    const isLast = s.currentIndex >= Math.max(0, s.queue.length - 1);
    if (isLast && s.repeatMode === "off") {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        positionMs: prev.durationMs,
      }));
      return;
    }

    const nextIndex = s.queue.length
      ? (s.currentIndex + 1) % s.queue.length
      : 0;
    // Use the same skip logic, but avoid capturing stale state by delegating.
    await skipToIndex(nextIndex);
  }, []);

  const onVideoPlaybackStatusUpdate = useCallback((status: any) => {
    void status;
  }, []);

  const unloadAudio = useCallback(async () => {
    setAudioSource(null);
    if (TrackPlayerAvailable) {
      try {
        await TrackPlayer.reset();
      } catch {
        // ignore
      }
    }
  }, []);

  const stopVideo = useCallback(async () => {
    videoPlayer?.pause();
  }, [videoPlayer]);

  const scheduleTokenRefresh = useCallback(
    (url: string | null, type: "audio" | "video") => {
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
        tokenRefreshTimerRef.current = null;
      }

      const expMs = decodeJwtExpMsFromUrl(url);
      if (!expMs) return;

      const now = Date.now();
      const delay = Math.max(10_000, expMs - now - 35_000); // 35s buffer
      logger.log(
        `[MediaPlayer] Scheduling ${type} refresh in ${Math.round(
          delay / 1000
        )}s`
      );

      tokenRefreshTimerRef.current = setTimeout(() => {
        (async () => {
          const item = currentItemRef.current;
          if (!item?.id) return;
          logger.log(`[MediaPlayer] Background refreshing ${type} URL...`);
          try {
            const nextUrl = await getPlaybackUrl(
              item.contentId ?? item.id,
              type,
              preferredQuality
            );
            if (type === "audio") {
              setAudioSource(nextUrl);
              scheduleTokenRefresh(nextUrl, "audio");
            } else {
              setVideoSource(nextUrl);
              scheduleTokenRefresh(nextUrl, "video");
            }
          } catch (e) {
            const presentation = getPlaybackErrorPresentation(e);
            logger.warn(
              `[MediaPlayer] Failed to background refresh ${type} token`,
              e
            );
            if (presentation.shouldStopPlayback) {
              if (type === "audio" && TrackPlayerAvailable) {
                try {
                  await TrackPlayer.pause();
                } catch {
                  // ignore native pause failures; state still fails closed
                }
              } else {
                try {
                  videoPlayer?.pause();
                } catch {
                  // ignore native pause failures; state still fails closed
                }
              }
              setState((s) => ({ ...s, isPlaying: false }));
              if (AppState.currentState === "active") {
                Alert.alert(presentation.title, presentation.message);
              }
            }
          }
        })().catch(() => undefined);
      }, delay);
    },
    [preferredQuality, videoPlayer]
  );

  const preloadNextItem = useCallback(async () => {
    const s = stateRef.current;
    if (!s.queue.length) return;
    const nextIdx = s.currentIndex + 1;
    if (nextIdx >= s.queue.length) return;
    const item = s.queue[nextIdx];
    if (!item?.id || preloadedUrlRef.current?.id === item.id) return;

    try {
      logger.log("[MediaPlayer] Preloading next item", { id: item.id });
      const url = await getPlaybackUrl(
        item.contentId ?? item.id,
        item.mediaType,
        preferredQuality
      );
      preloadedUrlRef.current = { id: item.id, url };
    } catch {
      // ignore
    }
  }, []);

  const loadAndPlayAudio = useCallback(
    async (item: MediaItem) => {
      if (await blockLockedPlayback(item)) return;
      const loadToken = (audioLoadTokenRef.current += 1);
      await stopVideo();
      await unloadAudio();

      // If another load started while we were stopping/unloading, abort.
      if (loadToken !== audioLoadTokenRef.current) return;

      const isSignedStreamUrl = (url: string) => {
        const u = (url ?? "").toString();
        if (!u) return false;
        // Signed local stream URLs look like /media/stream/:id?token=...&kind=audio
        if (/\/media\/stream\//i.test(u)) return true;
        if (/\btoken=/i.test(u) && /\bkind=audio\b/i.test(u)) return true;
        return false;
      };

      let playbackUrl = item.mediaUrl
        ? normalizePlaybackUrl(item.mediaUrl)
        : null;

      // Always fetch a fresh playback URL if stream access is required.
      // Do not reuse the `mediaUrl` populated by the initial list fetch because the JWT token might have expired.
      if (item.useStreamAccess) {
        try {
          playbackUrl = await getPlaybackUrl(
            item.contentId ?? item.id,
            "audio",
            preferredQuality
          );
        } catch (e) {
          const presentation = getPlaybackErrorPresentation(e);
          logger.warn("[MediaPlayer] getPlaybackUrl failed", e);
          Alert.alert(presentation.title, presentation.message);
          return;
        }
      }

      // Fallback: if still no URL but we have an item ID, try canonical stream resolution anyway.
      if (!playbackUrl && (item.contentId || item.id)) {
        try {
          const fallbackUrl = await getPlaybackUrl(
            item.contentId ?? item.id,
            "audio",
            preferredQuality
          );
          if (fallbackUrl) {
            playbackUrl = normalizePlaybackUrl(fallbackUrl);
            logger.log(
              "[MediaPlayer] Used fallback stream URL for",
              item.title
            );
          }
        } catch (e) {
          const presentation = getPlaybackErrorPresentation(e);
          logger.warn("[MediaPlayer] fallback stream resolution failed", e);
          Alert.alert(presentation.title, presentation.message);
          return;
        }
      }

      if (!playbackUrl) {
        Alert.alert(
          "Playback Error",
          "No playback URL available for this track."
        );
        return;
      }
      if (!validatePlaybackUrl(playbackUrl, "audio")) {
        Alert.alert("Playback Error", "Received an invalid audio source URL.");
        return;
      }

      // track-player automatically handles background audio settings when configured with capabilities

      // Check if TrackPlayer is available (Expo Go compatibility)
      if (!TrackPlayerAvailable) {
        try {
          logger.log("[MediaPlayer] TrackPlayer not available, falling back to videoPlayer for audio");
          setVideoSource(playbackUrl);
          scheduleTokenRefresh(playbackUrl, "audio");

          if (videoPlayer) {
            videoPlayer.replace(playbackUrl);
            videoPlayer.play();
            setState((s) => ({
              ...s,
              isPlaying: true,
              positionMs: 0,
              durationMs: item.duration || 0,
            }));
          }
        } catch (err) {
          logger.warn("[MediaPlayer] videoPlayer fallback for audio failed", err);
        }
        return;
      }

      try {
        logger.log("[MediaPlayer] Loading audio", { playbackUrl });
        setAudioSource(playbackUrl);
        scheduleTokenRefresh(playbackUrl, "audio");

        hasStartedPlayingRef.current = false;

        // Build track metadata for notification/lock screen display
        // Use artworkUrl from MediaItem type - this is the correct field for artwork
        const artworkUrl = item.artworkUrl || undefined;

        const track: Track = {
          id: item.id.toString(),
          url: playbackUrl,
          title: item.title || "Unknown Title",
          artist: item.artistName || "Unknown Artist",
          artwork: artworkUrl,
          // Additional metadata for better lock screen display
          album: (item as any).albumName || undefined,
          duration: item.duration ? item.duration / 1000 : undefined, // Convert ms to seconds
          // For proper notification styling
          isLiveStream: false,
        };

        logger.log("[MediaPlayer] Adding track to TrackPlayer:", {
          id: track.id,
          title: track.title,
          artist: track.artist,
          hasArtwork: !!track.artwork,
        });

        await TrackPlayer.reset();
        await TrackPlayer.add([track]);
        await TrackPlayer.play();

        // Update state to playing immediately
        setState((s) => ({
          ...s,
          isPlaying: true,
        }));

        logger.log("[MediaPlayer] Audio playback started successfully");
      } catch (err) {
        logger.warn("[MediaPlayer] Failed to create or play audio", err);
        Alert.alert(
          "Playback Error",
          "Could not start audio playback. Please check the media URL and try again."
        );
      }
    },
    [stopVideo, audioPlayer]
  );

  const prepareVideo = useCallback(async () => {
    await unloadAudio();
  }, [unloadAudio]);

  const blockLockedPlayback = useCallback(async (item: MediaItem) => {
    if (item.isLocked) {
      Alert.alert(
        "Subscription Required",
        `Full access to "${item.title}" requires a subscription to ${
          item.artistName || "this artist"
        }.`,
        [{ text: "Dismiss", style: "cancel" }]
      );
      return true;
    }
    return false;
  }, []);

  const playQueue = useCallback(
    async (queue: MediaItem[], index: number) => {
      const safeIndex = Math.min(
        Math.max(0, index),
        Math.max(0, queue.length - 1)
      );
      const nextState = stateRef.current.isShuffle
        ? shuffleQueueKeepCurrent(queue, safeIndex)
        : { queue, currentIndex: safeIndex };

      let item = nextState.queue[nextState.currentIndex];
      if (!item) return;

      if (await blockLockedPlayback(item)) {
        setState((s) => ({
          ...s,
          queue: nextState.queue,
          currentIndex: nextState.currentIndex,
        }));
        return;
      }

      if (item.mediaType === "video" && item.useStreamAccess) {
        try {
          const url = await getPlaybackUrl(
            item.contentId ?? item.id,
            "video",
            preferredQuality
          );
          if (!validatePlaybackUrl(url, "video")) {
            Alert.alert(
              "Playback Error",
              "Received an invalid video source URL."
            );
            return;
          }
          item = { ...item, mediaUrl: url };
          nextState.queue[nextState.currentIndex] = item;
        } catch (e) {
          const presentation = getPlaybackErrorPresentation(e);
          logger.warn("[MediaPlayer] getPlaybackUrl for video failed", e);
          Alert.alert(presentation.title, presentation.message);
          return;
        }
      }

      setState((s) => ({
        ...s,
        queue: nextState.queue,
        currentIndex: nextState.currentIndex,
        positionMs: 0,
        durationMs: 0,
        isExpanded: false,
      }));

      if (item.mediaType === "audio") {
        await loadAndPlayAudio(item);
        return;
      }

      await prepareVideo();
      setState((s) => ({ ...s, isPlaying: true }));
      // actual play is handled by Video component when it renders with shouldPlay
    },
    [
      blockLockedPlayback,
      loadAndPlayAudio,
      prepareVideo,
      shuffleQueueKeepCurrent,
    ]
  );

  const togglePlayPause = useCallback(async () => {
    const item = currentItemRef.current;
    if (stateRef.current.queue.length === 0) return;

    if (item.mediaType === "audio") {
      if (!TrackPlayerAvailable) {
        if (videoPlayer) {
          if (stateRef.current.isPlaying) {
            videoPlayer.pause();
            setState((s) => ({ ...s, isPlaying: false }));
          } else {
            videoPlayer.play();
            setState((s) => ({ ...s, isPlaying: true }));
          }
        }
        return;
      }
      try {
        const isCurrentlyPlaying = stateRef.current.isPlaying;
        if (isCurrentlyPlaying) {
          TrackPlayer.pause();
          setState((s) => ({ ...s, isPlaying: false }));
        } else {
          hasStartedPlayingRef.current = false;
          TrackPlayer.play();
          setState((s) => ({ ...s, isPlaying: true }));
        }
      } catch (err) {
        logger.warn("[MediaPlayer] togglePlayPause audio failed", err);
      }
      return;
    }

    if (!videoPlayer) return;
    try {
      const isCurrentlyPlaying = stateRef.current.isPlaying;
      if (isCurrentlyPlaying) {
        videoPlayer.pause();
        setState((s) => ({ ...s, isPlaying: false }));
      } else {
        hasStartedPlayingRef.current = false;
        videoPlayer.play();
        setState((s) => ({ ...s, isPlaying: true }));
      }
    } catch (err) {
      logger.warn("[MediaPlayer] togglePlayPause video failed", err);
    }
  }, [currentItem, audioPlayer, videoPlayer]);

  const seekTo = useCallback(
    async (positionMs: number) => {
      const item = currentItem;
      if (!item) return;

      const safe = Math.max(0, Math.round(positionMs));

      // Optimistically update the UI state to the target position
      // to prevent "jump back" jitter on real devices while native is catching up.
      setState((s) => ({ ...s, positionMs: safe }));

      if (item.mediaType === "audio") {
        if (!TrackPlayerAvailable) {
          if (videoPlayer) {
            videoPlayer.currentTime = safe / 1000;
          }
          return;
        }
        try {
          TrackPlayer.seekTo(safe / 1000);
        } catch (err) {
          logger.warn("[MediaPlayer] audio seekTo failed", err);
        }
        return;
      }

      if (!videoPlayer) return;
      try {
        // Use direct currentTime assignment for more reliable seeking in expo-video
        videoPlayer.currentTime = safe / 1000;
      } catch (err) {
        logger.warn("[MediaPlayer] video seekTo failed", err);
      }
    },
    [currentItem, audioPlayer, videoPlayer]
  );

  const skipToIndex = useCallback(
    async (nextIndex: number) => {
      const s = stateRef.current;
      const safeIndex = Math.min(
        Math.max(0, nextIndex),
        Math.max(0, s.queue.length - 1)
      );

      setState((prev) => ({
        ...prev,
        currentIndex: safeIndex,
        positionMs: 0,
        durationMs: 0,
        isExpanded: false,
        isPlaying: true,
      }));

      const item = s.queue[safeIndex];
      if (!item) return;

      // Use preloaded URL if available
      let playbackUrl = item.mediaUrl;
      if (preloadedUrlRef.current?.id === item.id) {
        playbackUrl = preloadedUrlRef.current.url;
        preloadedUrlRef.current = null; // consume it
      }

      if (item.mediaType === "audio") {
        await loadAndPlayAudio(item);
      } else {
        await prepareVideo();
        await applyPlaybackConfigToCurrent();
      }
    },
    [applyPlaybackConfigToCurrent, loadAndPlayAudio, prepareVideo]
  );

  const skipNext = useCallback(async () => {
    const s = stateRef.current;
    if (!s.queue.length) return;
    const isLast = s.currentIndex >= Math.max(0, s.queue.length - 1);
    if (isLast && s.repeatMode === "off") {
      return;
    }
    const next = (s.currentIndex + 1) % s.queue.length;
    await skipToIndex(next);
  }, [skipToIndex]);

  const skipPrev = useCallback(async () => {
    const s = stateRef.current;
    if (!s.queue.length) return;
    const prev = (s.currentIndex - 1 + s.queue.length) % s.queue.length;
    await skipToIndex(prev);
  }, [skipToIndex]);

  const setShuffle = useCallback(
    (enabled: boolean) => {
      setState((s) => {
        if (s.isShuffle === enabled) return s;
        if (!enabled) return { ...s, isShuffle: false };
        const shuffled = shuffleQueueKeepCurrent(s.queue, s.currentIndex);
        return {
          ...s,
          isShuffle: true,
          queue: shuffled.queue,
          currentIndex: shuffled.currentIndex,
        };
      });
    },
    [shuffleQueueKeepCurrent]
  );

  const toggleShuffle = useCallback(() => {
    setShuffle(!stateRef.current.isShuffle);
  }, [setShuffle]);

  const setRepeatMode = useCallback((mode: PlayerState["repeatMode"]) => {
    setState((s) => ({ ...s, repeatMode: mode }));
  }, []);

  const cycleRepeatMode = useCallback(() => {
    const current = stateRef.current.repeatMode;
    const next = current === "off" ? "all" : current === "all" ? "one" : "off";
    setRepeatMode(next);
  }, [setRepeatMode]);

  const setPlaybackRate = useCallback(
    async (rate: number) => {
      const safe = Math.max(0.5, Math.min(2, rate));
      setState((s) => ({ ...s, playbackRate: safe }));

      const item = currentItemRef.current;
      if (!item) return;
      try {
        if (item.mediaType === "audio") {
          if (TrackPlayerAvailable) {
            TrackPlayer.setRate(safe);
          }
        } else if (videoPlayer) {
          videoPlayer.playbackRate = safe;
        }
      } catch {
        // ignore
      }
    },
    [audioPlayer, videoPlayer]
  );

  const setVolume = useCallback(
    async (volume: number) => {
      const safe = Math.max(0, Math.min(1, volume));
      setState((s) => ({ ...s, volume: safe }));

      const item = currentItemRef.current;
      if (!item) return;
      try {
        if (item.mediaType === "audio") {
          if (TrackPlayerAvailable) {
            TrackPlayer.setVolume(safe);
          }
        } else if (videoPlayer) {
          videoPlayer.volume = safe;
        }
      } catch {
        // ignore
      }
    },
    [audioPlayer, videoPlayer]
  );

  const close = useCallback(async () => {
    await stopVideo();
    await unloadAudio();
    setState(EMPTY_STATE);
  }, [stopVideo, unloadAudio]);

  const setExpanded = useCallback((expanded: boolean) => {
    setState((s) => ({ ...s, isExpanded: expanded }));
  }, []);

  // Retry effect: if state says we should be playing but native isn't playing yet,
  // retry calling play(). This handles cases where the direct play() call in
  // loadAndPlayAudio fired before the native player finished initializing.
  useEffect(() => {
    if (
      !TrackPlayerAvailable ||
      !state.isPlaying ||
      !audioSource ||
      !isPlayerReady
    )
      return;

    // Polling retry
    const timer = setTimeout(async () => {
      try {
        const ts = await TrackPlayer.getState();
        if (ts !== TrackPlayerState?.Playing && stateRef.current.isPlaying) {
          TrackPlayer.play();
        }
      } catch {
        // Ignore errors from TrackPlayer in Expo Go
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [audioSource, state.isPlaying, isPlayerReady]);

  useEffect(() => {
    return () => {
      stopVideo().catch(() => undefined);
      unloadAudio().catch(() => undefined);
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
        tokenRefreshTimerRef.current = null;
      }
    };
  }, [stopVideo, unloadAudio]);

  // TrackPlayer remote event listeners for background/lock screen control synchronization
  useEffect(() => {
    if (!TrackPlayerAvailable || !isPlayerReady) return;

    logger.log("[MediaPlayer] Setting up TrackPlayer event listeners");

    // Listen for remote play events from notification/lock screen
    const remotePlaySubscription = TrackPlayer.addEventListener(
      Event?.RemotePlay,
      () => {
        logger.log("[MediaPlayer] RemotePlay event received");
        setState((s) => ({ ...s, isPlaying: true }));
      }
    );

    // Listen for remote pause events from notification/lock screen
    const remotePauseSubscription = TrackPlayer.addEventListener(
      Event?.RemotePause,
      () => {
        logger.log("[MediaPlayer] RemotePause event received");
        setState((s) => ({ ...s, isPlaying: false }));
      }
    );

    // Listen for remote next events from notification/lock screen
    const remoteNextSubscription = TrackPlayer.addEventListener(
      Event?.RemoteNext,
      () => {
        logger.log("[MediaPlayer] RemoteNext event received");
        const s = stateRef.current;
        if (!s.queue.length) return;
        const isLast = s.currentIndex >= Math.max(0, s.queue.length - 1);
        if (!isLast || s.repeatMode !== "off") {
          const next = (s.currentIndex + 1) % s.queue.length;
          skipToIndex(next).catch(() => undefined);
        }
      }
    );

    // Listen for remote previous events from notification/lock screen
    const remotePrevSubscription = TrackPlayer.addEventListener(
      Event?.RemotePrevious,
      () => {
        console.log("[MediaPlayer] RemotePrevious event received");
        const s = stateRef.current;
        if (!s.queue.length) return;
        const prev = (s.currentIndex - 1 + s.queue.length) % s.queue.length;
        skipToIndex(prev).catch(() => undefined);
      }
    );

    // Listen for remote seek events from notification progress bar
    const remoteSeekSubscription = TrackPlayer.addEventListener(
      Event?.RemoteSeek,
      (event: any) => {
        console.log("[MediaPlayer] RemoteSeek event received:", event.position);
        const pos = Math.round(event.position * 1000);
        setState((s) => ({ ...s, positionMs: pos }));
      }
    );

    // Handle audio ducking (interruptions like phone calls)
    const remoteDuckSubscription = TrackPlayer.addEventListener(
      Event?.RemoteDuck,
      async (event: any) => {
        console.log("[MediaPlayer] RemoteDuck event:", event);
        if (event.permanent) {
          // Permanent interruption (phone call) - pause and update state
          setState((s) => ({ ...s, isPlaying: false }));
        } else if (event.paused) {
          // Temporary interruption started
          setState((s) => ({ ...s, isPlaying: false }));
        } else {
          // Temporary interruption ended - resume if we were playing
          const wasPlaying = stateRef.current.isPlaying;
          if (wasPlaying) {
            setState((s) => ({ ...s, isPlaying: true }));
          }
        }
      }
    );

    // Playback progress tracking for real-time position updates
    const playbackProgressSubscription = TrackPlayer.addEventListener(
      Event?.PlaybackProgress,
      (event: any) => {
        const pos = Math.round(event.position * 1000);
        const dur = Math.round(event.duration * 1000);
        console.log("[MediaPlayer] PlaybackProgress event:", { pos, dur });
        setState((s) => ({
          ...s,
          positionMs: pos,
          durationMs: dur,
        }));
      }
    );

    // Playback state change tracking
    const playbackStateSubscription = TrackPlayer.addEventListener(
      Event?.PlaybackState,
      (playbackState: any) => {
        const isPlaying = playbackState.state === TrackPlayerState?.Playing;
        console.log(
          "[MediaPlayer] PlaybackState changed:",
          playbackState.state,
          "isPlaying:",
          isPlaying
        );

        // Sync state if different from current
        if (stateRef.current.isPlaying !== isPlaying) {
          setState((s) => ({ ...s, isPlaying }));
        }
      }
    );

    // Track changed event
    const trackChangedSubscription = TrackPlayer.addEventListener(
      Event?.PlaybackTrackChanged,
      (event: any) => {
        console.log("[MediaPlayer] PlaybackTrackChanged:", event);
      }
    );

    // Playback error handling
    const playbackErrorSubscription = TrackPlayer.addEventListener(
      Event?.PlaybackError,
      (error: any) => {
        console.error("[MediaPlayer] PlaybackError:", error);
        // Pause on error
        setState((s) => ({ ...s, isPlaying: false }));
      }
    );

    console.log("[MediaPlayer] TrackPlayer event listeners registered");

    return () => {
      console.log("[MediaPlayer] Cleaning up TrackPlayer event listeners");
      remotePlaySubscription.remove();
      remotePauseSubscription.remove();
      remoteNextSubscription.remove();
      remotePrevSubscription.remove();
      remoteSeekSubscription.remove();
      remoteDuckSubscription.remove();
      playbackProgressSubscription.remove();
      playbackStateSubscription.remove();
      trackChangedSubscription.remove();
      playbackErrorSubscription.remove();
    };
  }, [isPlayerReady, skipToIndex]);

  // Polling for progress updates - works on both web and native
  // PlaybackProgress events may not fire consistently on all platforms
  useEffect(() => {
    if (!TrackPlayerAvailable || !isPlayerReady) return;

    let isPolling = false;
    const interval = setInterval(async () => {
      if (!isPlayerReady || isPolling) return;

      isPolling = true;
      try {
        const progress = await TrackPlayer.getProgress();
        const pos = Math.max(0, Math.round(progress.position * 1000));
        const dur = Math.max(0, Math.round(progress.duration * 1000));

        setState((s) => ({
          ...s,
          positionMs: pos,
          durationMs: dur,
        }));
      } catch (e) {
        console.log("[MediaPlayer] Polling error:", e);
      } finally {
        isPolling = false;
      }
    }, 100); // 100ms for smooth updates
    return () => {
      clearInterval(interval);
      isPolling = false;
    };
  }, [isPlayerReady]);
 
  // Polling for videoPlayer progress fallback (e.g. Web / Expo Go)
  useEffect(() => {
    if (TrackPlayerAvailable || !videoPlayer) return;

    let active = true;
    const interval = setInterval(() => {
      if (!active || !videoPlayer) return;
      try {
        const pos = Math.max(0, Math.round(videoPlayer.currentTime * 1000));
        const dur = Math.max(0, Math.round(videoPlayer.duration * 1000));
        setState((s) => {
          if (s.isPlaying) {
            return {
              ...s,
              positionMs: pos,
              durationMs: dur > 0 ? dur : s.durationMs,
            };
          }
          return s;
        });
      } catch (e) {
        // ignore
      }
    }, 100); // 100ms interval for fallback smoothness

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [videoPlayer]);

  const value = useMemo<MediaPlayerContextValue>(
    () => ({
      state,
      currentItem,
      playQueue,
      togglePlayPause,
      seekTo,
      skipNext,
      skipPrev,
      setShuffle,
      toggleShuffle,
      setRepeatMode,
      cycleRepeatMode,
      setPlaybackRate,
      setVolume,
      close,
      setExpanded,

      videoAudioOnlyMode,
      videoRestoreNonce,
      videoRestorePositionMs: videoRestorePositionMsRef.current,

      inlineVideoHostActive,
      setInlineVideoHostActive,

      inlineAudioHostActive,
      setInlineAudioHostActive,
      onVideoPlaybackStatusUpdate,
      videoPlayer,
      audioPlayer,
      isPlayerReady,
      preferredQuality,
      setPreferredQuality,
    }),
    [
      close,
      currentItem,
      cycleRepeatMode,
      inlineAudioHostActive,
      inlineVideoHostActive,
      onVideoPlaybackStatusUpdate,
      playQueue,
      seekTo,
      setPlaybackRate,
      setRepeatMode,
      setExpanded,
      setShuffle,
      setInlineAudioHostActive,
      skipNext,
      skipPrev,
      state,
      setVolume,
      setInlineVideoHostActive,
      toggleShuffle,
      togglePlayPause,
      videoAudioOnlyMode,
      videoRestoreNonce,
      videoPlayer,
      audioPlayer,
      isPlayerReady,
      preferredQuality,
      setPreferredQuality,
    ]
  );

  return (
    <MediaPlayerContext.Provider value={value}>
      {children}
    </MediaPlayerContext.Provider>
  );
}
