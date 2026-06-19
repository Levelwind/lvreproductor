import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Howl, Howler } from 'howler';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverArt?: string;
  urlPath: string;
  filePath?: string;
  lyrics?: string;
  syncedLyrics?: string;
  canvasPath?: string;
  mtimeMs?: number;
  fileSize?: number;
  isUnavailable?: boolean;
}

export type LoopMode = 'off' | 'all' | 'one';

interface PlaybackState {
  isPlaying: boolean;
  currentTrack: Track | null;
  volume: number;
  progress: number;
  duration: number;
  isShuffle: boolean;
  loopMode: LoopMode;
  queue: Track[];
  shuffledQueue: Track[];
  playQueue: Track[];
}

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  isShuffle: boolean;
  loopMode: LoopMode;
  playTrack: (track: Track, queue?: Track[] | null, startPos?: number, playlistId?: string | null) => void;
  togglePlay: () => void;
  setVolume: (val: number) => void;
  seekTo: (percent: number) => void;
  toggleShuffle: () => void;
  toggleLoop: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
  playQueue: Track[];
  addToPlayQueue: (track: Track) => void;
}

type PlayerEvent =
  | { type: 'full'; state: PlaybackState }
  | { type: 'update'; property: keyof PlaybackState; value: PlaybackState[keyof PlaybackState] };

const PlayerContext = createContext<PlayerContextType | null>(null);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocalHostname(hostname: string) {
  return LOCAL_HOSTS.has(hostname);
}

export function getApiBase() {
  const hostname = window.location.hostname;
  return isLocalHostname(hostname) ? 'http://localhost:4000' : `http://${hostname}:4000`;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch (err) {
    console.error(`Error parsing ${key} from localStorage:`, err);
    return fallback;
  }
}

function readNumberStorage(key: string, fallback: number) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;

    const value = Number.parseFloat(saved);
    return Number.isFinite(value) ? value : fallback;
  } catch (err) {
    return fallback;
  }
}

function readLoopModeStorage() {
  try {
    const saved = localStorage.getItem('level_player_loop_mode');
    return saved === 'all' || saved === 'one' || saved === 'off' ? saved : 'off';
  } catch (err) {
    return 'off';
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`[Storage] No se pudo guardar ${key} en localStorage:`, err);
  }
}

function safeRemoveItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[Storage] No se pudo remover ${key} de localStorage:`, err);
  }
}

function distributeShuffle(tracks: Track[], history: string[] = []): Track[] {
  if (tracks.length <= 1) return tracks;

  const grouped = tracks.reduce((acc, track) => {
    const artist = track.artist || 'Unknown';
    if (!acc[artist]) acc[artist] = [];
    acc[artist].push(track);
    return acc;
  }, {} as Record<string, Track[]>);

  const shuffleArray = (arr: Track[]) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  for (const artist of Object.keys(grouped)) {
    grouped[artist] = shuffleArray(grouped[artist]);
  }

  const spreadList: { track: Track; sortKey: number }[] = [];
  const artists = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

  for (const artist of artists) {
    const artistTracks = grouped[artist];
    const count = artistTracks.length;
    const step = tracks.length / count;
    const offset = Math.random() * step;

    artistTracks.forEach((track, i) => {
      const jitter = Math.random() * 0.2;
      let sortKey = offset + (i * step) + jitter;

      if (history.length > 0) {
        const historyIndex = history.indexOf(track.id);
        if (historyIndex !== -1) {
          const recencyFactor = (historyIndex + 1) / history.length;
          const penalty = recencyFactor * tracks.length * 0.7;
          sortKey += penalty;
        }
      }

      spreadList.push({ track, sortKey });
    });
  }

  spreadList.sort((a, b) => a.sortKey - b.sortKey);
  return spreadList.map(item => item.track);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const apiBase = getApiBase();
  const isLocalMode = isLocalHostname(window.location.hostname);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(() =>
    isLocalMode ? null : readJsonStorage<Track | null>('level_player_current_track', null)
  );
  const [queue, setQueue] = useState<Track[]>(() =>
    isLocalMode ? [] : readJsonStorage<Track[]>('level_player_queue', [])
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(() =>
    isLocalMode ? 0.8 : readNumberStorage('level_player_volume', 0.8)
  );
  const [progress, setProgress] = useState(() =>
    isLocalMode ? 0 : readNumberStorage('level_player_progress', 0)
  );
  const [duration, setDuration] = useState(() =>
    isLocalMode ? 0 : readNumberStorage('level_player_duration', 0)
  );
  const [isShuffle, setIsShuffle] = useState(() =>
    isLocalMode ? false : localStorage.getItem('level_player_is_shuffle') === 'true'
  );
  const [shuffledQueue, setShuffledQueue] = useState<Track[]>(() =>
    isLocalMode ? [] : readJsonStorage<Track[]>('level_player_shuffled_queue', [])
  );
  const [playQueue, setPlayQueue] = useState<Track[]>(() =>
    isLocalMode ? [] : readJsonStorage<Track[]>('level_player_play_queue', [])
  );
  const [loopMode, setLoopMode] = useState<LoopMode>(() =>
    isLocalMode ? 'off' : readLoopModeStorage()
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [history, setHistory] = useState<string[]>(() =>
    isLocalMode ? [] : readJsonStorage<string[]>('level_player_history', [])
  );

  const soundRef = useRef<Howl | null>(null);
  const intervalRef = useRef<number | null>(null);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);
  const progressRef = useRef(progress);
  const durationRef = useRef(duration);
  const isShuffleRef = useRef(isShuffle);
  const shuffledQueueRef = useRef(shuffledQueue);
  const playQueueRef = useRef(playQueue);
  const loopModeRef = useRef(loopMode);
  const historyRef = useRef(history);
  const preloadedTrackRef = useRef<Track | null>(null);
  const preloadedSoundRef = useRef<Howl | null>(null);
  const lastPrevClickRef = useRef<number>(0);
  const preloadTimerRef = useRef<number | null>(null);

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { shuffledQueueRef.current = shuffledQueue; }, [shuffledQueue]);
  useEffect(() => { playQueueRef.current = playQueue; }, [playQueue]);
  useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);
  useEffect(() => { historyRef.current = history; }, [history]);

  useEffect(() => {
    if (isLocalMode) return;

    if (currentTrack) {
      safeSetItem('level_player_current_track', JSON.stringify(currentTrack));
    } else {
      safeRemoveItem('level_player_current_track');
    }
  }, [currentTrack, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_queue', JSON.stringify(queue));
  }, [queue, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_volume', volume.toString());
  }, [volume, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_is_shuffle', isShuffle.toString());
  }, [isShuffle, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_shuffled_queue', JSON.stringify(shuffledQueue));
  }, [shuffledQueue, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_play_queue', JSON.stringify(playQueue));
  }, [playQueue, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_loop_mode', loopMode);
  }, [loopMode, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) safeSetItem('level_player_duration', duration.toString());
  }, [duration, isLocalMode]);

  useEffect(() => {
    if (!isLocalMode) return;

    stopRemoteSound();
    console.log('[Mode] Modo local activo. El navegador controla mpv por SSE/API.');

    const eventSource = new EventSource(`${apiBase}/api/player/events`);

    eventSource.onmessage = (event) => {
      try {
        applyPlayerEvent(JSON.parse(event.data) as PlayerEvent);
      } catch (err) {
        console.error('[SSE] Evento invalido:', err);
      }
    };

    eventSource.onerror = () => {
      console.warn('[SSE] Error de conexion. El navegador reintentara automaticamente.');
    };

    return () => {
      eventSource.close();
    };
  }, [apiBase, isLocalMode]);

  useEffect(() => {
    if (isLocalMode || !isShuffle || queue.length === 0) return;

    const queueIds = new Set(queue.map(track => track.id));
    const shuffledIds = new Set(shuffledQueue.map(track => track.id));
    const queueChanged = queue.length !== shuffledQueue.length ||
      [...queueIds].some(id => !shuffledIds.has(id));

    if (!queueChanged) return;

    const nextShuffled = createShuffledQueue(queue, currentTrack);
    shuffledQueueRef.current = nextShuffled;
    setShuffledQueue(nextShuffled);
  }, [currentTrack, isLocalMode, isShuffle, queue, shuffledQueue]);

  useEffect(() => {
    return () => {
      stopRemoteSound();
      unloadPreloadedSound();
      Howler.unload();
    };
  }, []);

  function applyPlayerEvent(event: PlayerEvent) {
    if (event.type === 'full') {
      applyPlaybackState(event.state);
      return;
    }

    applyPlaybackUpdate(event.property, event.value);
  }

  function applyPlaybackState(state: Partial<PlaybackState>) {
    if (state.currentTrack !== undefined) {
      currentTrackRef.current = state.currentTrack;
      setCurrentTrack(state.currentTrack);
    }
    if (state.isPlaying !== undefined) {
      isPlayingRef.current = state.isPlaying as boolean;
      setIsPlaying(state.isPlaying as boolean);
    }
    if (state.volume !== undefined) {
      volumeRef.current = state.volume as number;
      setVolumeState(state.volume as number);
    }
    if (state.progress !== undefined) {
      progressRef.current = state.progress as number;
      setProgress(state.progress as number);
    }
    if (state.duration !== undefined) {
      durationRef.current = state.duration as number;
      setDuration(state.duration as number);
    }
    if (state.isShuffle !== undefined) {
      isShuffleRef.current = state.isShuffle as boolean;
      setIsShuffle(state.isShuffle as boolean);
    }
    if (state.loopMode !== undefined) {
      loopModeRef.current = state.loopMode as LoopMode;
      setLoopMode(state.loopMode as LoopMode);
    }
    // queue y shuffledQueue no se reciben del backend por SSE
    // (el frontend gestiona su propia cola localmente)
    if (state.queue) {
      queueRef.current = state.queue;
      setQueue(state.queue);
    }
    if (state.shuffledQueue) {
      shuffledQueueRef.current = state.shuffledQueue;
      setShuffledQueue(state.shuffledQueue);
    }
    if (state.playQueue) {
      playQueueRef.current = state.playQueue;
      setPlayQueue(state.playQueue);
    }
  }

  function applyPlaybackUpdate(property: keyof PlaybackState, value: PlaybackState[keyof PlaybackState]) {
    switch (property) {
      case 'currentTrack':
        currentTrackRef.current = value as Track | null;
        setCurrentTrack(value as Track | null);
        break;
      case 'queue':
        queueRef.current = value as Track[];
        setQueue(value as Track[]);
        break;
      case 'isPlaying':
        isPlayingRef.current = value as boolean;
        setIsPlaying(value as boolean);
        break;
      case 'volume':
        volumeRef.current = value as number;
        setVolumeState(value as number);
        break;
      case 'progress':
        progressRef.current = value as number;
        setProgress(value as number);
        break;
      case 'duration':
        durationRef.current = value as number;
        setDuration(value as number);
        break;
      case 'isShuffle':
        isShuffleRef.current = value as boolean;
        setIsShuffle(value as boolean);
        break;
      case 'shuffledQueue':
        shuffledQueueRef.current = value as Track[];
        setShuffledQueue(value as Track[]);
        break;
      case 'playQueue':
        playQueueRef.current = value as Track[];
        setPlayQueue(value as Track[]);
        break;
      case 'loopMode':
        loopModeRef.current = value as LoopMode;
        setLoopMode(value as LoopMode);
        break;
    }
  }

  function postPlayerCommand(endpoint: string, body?: unknown) {
    const init: RequestInit = { method: 'POST' };

    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    fetch(`${apiBase}/api/player/${endpoint}`, init)
      .catch(err => console.error(`[Player API] Error en ${endpoint}:`, err));
  }

  function clearIntervalSafe() {
    if (!intervalRef.current) return;

    window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }

  function clearPreloadTimerSafe() {
    if (preloadTimerRef.current) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
  }

  function stopRemoteSound() {
    clearIntervalSafe();
    clearPreloadTimerSafe();

    if (soundRef.current) {
      try {
        const sounds = (soundRef.current as any)._sounds;
        if (sounds && sounds.length > 0 && sounds[0]._node) {
          const node = sounds[0]._node as HTMLAudioElement;
          node.src = '';
          node.load();
        }
      } catch (err) {
        console.warn('[Player] Error al forzar liberacion de red de Howler:', err);
      }
      soundRef.current.unload();
      soundRef.current = null;
    }
  }

  function addToHistory(trackId: string) {
    const filtered = historyRef.current.filter(id => id !== trackId);
    const next = [...filtered, trackId].slice(-50);
    historyRef.current = next;
    setHistory(next);
    safeSetItem('level_player_history', JSON.stringify(next));
  }

  function createShuffledQueue(baseQueue: Track[], firstTrack: Track | null) {
    let shuffled = distributeShuffle(baseQueue, historyRef.current);

    if (firstTrack) {
      shuffled = [firstTrack, ...shuffled.filter(track => track.id !== firstTrack.id)];
    }

    return shuffled;
  }

  function buildStreamUrl(track: Track) {
    if (/^https?:\/\//i.test(track.urlPath)) return track.urlPath;
    if (track.urlPath) return `${apiBase}${track.urlPath}`;
    if (track.filePath) return `${apiBase}/api/stream?path=${encodeURIComponent(track.filePath)}`;
    return '';
  }

  function getTrackFormat(track: Track): string {
    const pathStr = track.filePath || track.urlPath || '';
    const parts = pathStr.split('.');
    if (parts.length > 1) {
      const ext = parts.pop()?.split('?')[0]?.toLowerCase();
      if (ext && ['flac', 'mp3', 'aac', 'm4a', 'mp4', 'wav', 'ogg'].includes(ext)) {
        return ext;
      }
    }
    return 'mp3';
  }

  function getTrackFormats(track: Track): string[] {
    const primary = getTrackFormat(track);
    const defaults = ['flac', 'mp3', 'aac', 'm4a', 'mp4', 'wav', 'ogg'];
    return [primary, ...defaults.filter(f => f !== primary)];
  }

  function unloadPreloadedSound() {
    if (preloadedSoundRef.current) {
      try {
        const sounds = (preloadedSoundRef.current as any)._sounds;
        if (sounds && sounds.length > 0 && sounds[0]._node) {
          const node = sounds[0]._node as HTMLAudioElement;
          node.src = '';
          node.load();
        }
      } catch (err) {
        console.warn('[Player] Error al forzar liberacion de red de Howler precargado:', err);
      }
      preloadedSoundRef.current.unload();
      preloadedSoundRef.current = null;
    }
    preloadedTrackRef.current = null;
  }

  function preloadNextTrack() {
    if (isLocalMode) return;

    let nextTrack: Track | null = null;

    if (playQueueRef.current.length > 0) {
      nextTrack = playQueueRef.current[0];
    } else {
      const activeQueue = isShuffleRef.current ? shuffledQueueRef.current : queueRef.current;
      const track = currentTrackRef.current;
      if (track && activeQueue.length > 0) {
        const index = activeQueue.findIndex(item => item.id === track.id);
        if (index >= 0 && index < activeQueue.length - 1) {
          nextTrack = activeQueue[index + 1];
        } else if (index === activeQueue.length - 1 && loopModeRef.current === 'all') {
          nextTrack = activeQueue[0];
        }
      }
    }

    if (!nextTrack) {
      unloadPreloadedSound();
      return;
    }

    if (preloadedTrackRef.current?.id === nextTrack.id) {
      return;
    }

    unloadPreloadedSound();

    preloadedTrackRef.current = nextTrack;
    const streamUrl = buildStreamUrl(nextTrack);
    if (!streamUrl) return;

    console.log('[Player] Precargando en segundo plano siguiente track en Howl:', nextTrack.title);

    // Precargamos la instancia de Howl con html5: true y preload: true
    preloadedSoundRef.current = new Howl({
      src: [streamUrl],
      html5: true,
      format: getTrackFormats(nextTrack),
      volume: 0, // Precarga silenciosa
      preload: true,
      onload: () => {
        console.log('[Player] Siguiente track precargado en Howl (HTML5):', nextTrack?.title);
      }
    });
  }

  function startRemoteTrack(track: Track, newQueue?: Track[], startPos = 0) {
    stopRemoteSound();

    const nextQueue = newQueue || queueRef.current;
    if (newQueue) {
      queueRef.current = newQueue;
      setQueue(newQueue);
    }

    if (isShuffleRef.current && nextQueue.length > 0) {
      const isNewQueue = !!newQueue;
      const hasEmptyShuffle = shuffledQueueRef.current.length === 0;
      if (isNewQueue || hasEmptyShuffle) {
        const nextShuffled = createShuffledQueue(nextQueue, track);
        shuffledQueueRef.current = nextShuffled;
        setShuffledQueue(nextShuffled);
      }
    }

    currentTrackRef.current = track;
    progressRef.current = startPos;
    setCurrentTrack(track);
    setProgress(startPos);

    // Inicializar duración con metadatos del track (o 0 si no existen) para limpiar la barra anterior
    const initialDuration = track.duration || 0;
    durationRef.current = initialDuration;
    setDuration(initialDuration);

    localStorage.setItem('level_player_progress', startPos.toString());
    localStorage.setItem('level_player_duration', initialDuration.toString());
    addToHistory(track.id);

    const streamUrl = buildStreamUrl(track);
    if (!streamUrl) {
      console.error('[Player] El track no tiene urlPath ni filePath para streaming.');
      return;
    }

    let initialSeekDone = false;
    let sound: Howl;

    const onPlay = () => {
      isPlayingRef.current = true;
      setIsPlaying(true);

      const remoteDuration = sound.duration();
      if (remoteDuration && remoteDuration > 0) {
        durationRef.current = remoteDuration;
        setDuration(remoteDuration);
      }

      if (startPos > 0 && !initialSeekDone) {
        initialSeekDone = true;
        sound.seek(startPos);
      }

      clearIntervalSafe();
      let lastSaveTime = 0;

      intervalRef.current = window.setInterval(() => {
        if (!sound.playing()) return;

        const position = sound.seek() as number;
        progressRef.current = position;
        setProgress(position);

        const now = Date.now();
        if (now - lastSaveTime >= 1000) {
          localStorage.setItem('level_player_progress', position.toString());
          lastSaveTime = now;
        }

        const currentDuration = sound.duration();
        if (currentDuration && currentDuration > 0 && currentDuration !== durationRef.current) {
          durationRef.current = currentDuration;
          setDuration(currentDuration);
        }
      }, 150);

      // Precargar la siguiente canción tras un delay de 2s para estabilidad
      clearPreloadTimerSafe();
      preloadTimerRef.current = window.setTimeout(() => {
        preloadNextTrack();
      }, 2000);
    };

    const onPause = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
    };

    const onStop = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      clearIntervalSafe();
    };

    const onEnd = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      clearIntervalSafe();
      handleRemoteTrackEnd();
    };

    const onLoad = () => {
      const remoteDuration = sound.duration();
      if (remoteDuration && remoteDuration > 0) {
        durationRef.current = remoteDuration;
        setDuration(remoteDuration);
      }

      if (startPos > 0 && !initialSeekDone) {
        initialSeekDone = true;
        sound.seek(startPos);
      }
    };

    const onLoadError = (_id: any, err: any) => {
      console.error('[Player] Error cargando track remoto:', err);
    };

    const onPlayError = (_id: any, err: any) => {
      console.error('[Player] Error reproduciendo track remoto:', err);
    };

    // Reutilizar la instancia precargada si existe y coincide
    if (preloadedTrackRef.current?.id === track.id && preloadedSoundRef.current) {
      console.log('[Player] Reutilizando instancia de Howl precargada para:', track.title);
      sound = preloadedSoundRef.current;
      sound.off(); // Eliminar callbacks de precarga silenciosa

      sound.on('play', onPlay);
      sound.on('pause', onPause);
      sound.on('stop', onStop);
      sound.on('end', onEnd);
      sound.on('load', onLoad);
      sound.on('loaderror', onLoadError);
      sound.on('playerror', onPlayError);

      sound.volume(volumeRef.current);

      if (sound.state() === 'loaded') {
        onLoad();
      }

      preloadedTrackRef.current = null;
      preloadedSoundRef.current = null;
    } else {
      sound = new Howl({
        src: [streamUrl],
        html5: true,
        format: getTrackFormats(track),
        volume: volumeRef.current,
        onplay: onPlay,
        onpause: onPause,
        onstop: onStop,
        onend: onEnd,
        onload: onLoad,
        onloaderror: onLoadError,
        onplayerror: onPlayError
      });
    }

    soundRef.current = sound;
    sound.play();
  }

  function playTrack(track: Track, newQueue?: Track[] | null, startPos = 0, playlistId?: string | null) {
    const isSameQueue = !newQueue || (
      newQueue.length === queueRef.current.length &&
      newQueue.every((t, idx) => t.id === queueRef.current[idx]?.id)
    );

    if (isLocalMode) {
      if (currentTrackRef.current?.id === track.id && isSameQueue && startPos === 0) {
        postPlayerCommand('play');
        return;
      }

      postPlayerCommand('play', {
        trackId: track.id,
        ...(newQueue ? { queueTrackIds: newQueue.map(t => t.id) } : {}),
        ...(playlistId !== undefined ? { playlistId } : {}),
        startPos
      });
      return;
    }

    if (currentTrackRef.current?.id === track.id && soundRef.current && isSameQueue && startPos === 0) {
      togglePlay();
      return;
    }

    startRemoteTrack(track, newQueue || undefined, startPos);
  }

  function togglePlay() {
    if (isLocalMode) {
      postPlayerCommand('play');
      return;
    }

    if (!soundRef.current) {
      const track = currentTrackRef.current;
      if (track) startRemoteTrack(track, queueRef.current, progressRef.current);
      return;
    }

    if (isPlayingRef.current) {
      soundRef.current.pause();
    } else {
      soundRef.current.play();
    }
  }

  function setVolume(val: number) {
    const nextVolume = Math.max(0, Math.min(1, val));
    volumeRef.current = nextVolume;
    setVolumeState(nextVolume);

    if (isLocalMode) {
      postPlayerCommand('volume', { volume: nextVolume });
      return;
    }

    soundRef.current?.volume(nextVolume);
  }

  function seekTo(percent: number) {
    const currentDuration = durationRef.current || soundRef.current?.duration() || 0;
    if (currentDuration <= 0) return;

    const boundedPercent = Math.max(0, Math.min(1, percent));
    const targetSeconds = boundedPercent * currentDuration;
    progressRef.current = targetSeconds;
    setProgress(targetSeconds);
    localStorage.setItem('level_player_progress', targetSeconds.toString());

    if (isLocalMode) {
      postPlayerCommand('seek', { seconds: targetSeconds });
      return;
    }

    soundRef.current?.seek(targetSeconds);
  }

  function toggleShuffle() {
    if (isLocalMode) {
      postPlayerCommand('shuffle');
      return;
    }

    const nextShuffle = !isShuffleRef.current;
    isShuffleRef.current = nextShuffle;
    setIsShuffle(nextShuffle);

    if (nextShuffle && queueRef.current.length > 0) {
      const nextShuffled = createShuffledQueue(queueRef.current, currentTrackRef.current);
      shuffledQueueRef.current = nextShuffled;
      setShuffledQueue(nextShuffled);
    } else {
      shuffledQueueRef.current = [];
      setShuffledQueue([]);
    }
  }

  function toggleLoop() {
    if (isLocalMode) {
      postPlayerCommand('loop');
      return;
    }

    const nextLoopMode: LoopMode =
      loopModeRef.current === 'off' ? 'all' : loopModeRef.current === 'all' ? 'one' : 'off';
    loopModeRef.current = nextLoopMode;
    setLoopMode(nextLoopMode);
  }

  function addToPlayQueue(track: Track) {
    if (isLocalMode) {
      postPlayerCommand('queue/add', { trackId: track.id });
      return;
    }

    setPlayQueue(prev => [...prev, track]);
  }

  function handleRemoteTrackEnd() {
    if (loopModeRef.current === 'one' && currentTrackRef.current) {
      startRemoteTrack(currentTrackRef.current, queueRef.current, 0);
      return;
    }

    if (playQueueRef.current.length > 0) {
      const nextTrack = playQueueRef.current[0];
      setPlayQueue(prev => prev.slice(1));
      startRemoteTrack(nextTrack, queueRef.current, 0);
      return;
    }

    const activeQueue = isShuffleRef.current ? shuffledQueueRef.current : queueRef.current;
    const track = currentTrackRef.current;
    if (!track || activeQueue.length === 0) return;

    const index = activeQueue.findIndex(item => item.id === track.id);
    if (index >= 0 && index < activeQueue.length - 1) {
      startRemoteTrack(activeQueue[index + 1], queueRef.current, 0);
    } else if (index === activeQueue.length - 1 && loopModeRef.current === 'all') {
      startRemoteTrack(activeQueue[0], queueRef.current, 0);
    }
  }

  function skipNext() {
    if (isLocalMode) {
      postPlayerCommand('next');
      return;
    }

    handleRemoteTrackEnd();
  }

  function skipPrevious() {
    if (isLocalMode) {
      postPlayerCommand('prev');
      return;
    }

    const activeQueue = isShuffleRef.current ? shuffledQueueRef.current : queueRef.current;
    const track = currentTrackRef.current;
    if (!track || activeQueue.length === 0) return;

    const now = Date.now();
    const timeSinceLastClick = now - lastPrevClickRef.current;
    lastPrevClickRef.current = now;

    // Si pulsó "Atrás" hace menos de 2 segundos, o si el progreso actual es menor a 3s,
    // cambiamos al track anterior. Si no, solo reiniciamos la canción.
    const currentPosition = progressRef.current;
    if (currentPosition > 3 && timeSinceLastClick > 2000) {
      soundRef.current?.seek(0);
      progressRef.current = 0;
      setProgress(0);
      localStorage.setItem('level_player_progress', '0');
      return;
    }

    const index = activeQueue.findIndex(item => item.id === track.id);
    if (index > 0) {
      startRemoteTrack(activeQueue[index - 1], queueRef.current, 0);
    } else if (index === 0 && loopModeRef.current === 'all') {
      startRemoteTrack(activeQueue[activeQueue.length - 1], queueRef.current, 0);
    }
  }

  function toggleFullscreen() {
    setIsFullscreen(prev => !prev);
  }

  return (
    <PlayerContext.Provider value={{
      currentTrack,
      isPlaying,
      volume,
      progress,
      duration,
      isShuffle,
      loopMode,
      playTrack,
      togglePlay,
      setVolume,
      seekTo,
      toggleShuffle,
      toggleLoop,
      isFullscreen,
      toggleFullscreen,
      skipNext,
      skipPrevious,
      playQueue,
      addToPlayQueue
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
};
