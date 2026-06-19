import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Howl, Howler } from 'howler';

// Algoritmo de Shuffle Distribuido (estilo Spotify) sensible al historial de reproducción reciente
function distributeShuffle(tracks: Track[], history: string[] = []): Track[] {
  if (tracks.length <= 1) return tracks;
  
  // 1. Agrupar por artista
  const grouped = tracks.reduce((acc, track) => {
    const artist = track.artist || 'Unknown';
    if (!acc[artist]) acc[artist] = [];
    acc[artist].push(track);
    return acc;
  }, {} as Record<string, Track[]>);

  // 2. Mezclar las canciones dentro de cada artista (Fisher-Yates)
  const shuffleArray = (arr: Track[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  for (const artist in grouped) {
    grouped[artist] = shuffleArray(grouped[artist]);
  }

  // 3. Distribuir uniformemente (Dithering)
  const spreadList: { track: Track; sortKey: number }[] = [];
  const artists = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

  for (const artist of artists) {
    const artistTracks = grouped[artist];
    const count = artistTracks.length;
    // Espacio ideal entre canciones del mismo artista
    const step = tracks.length / count;
    // Un offset inicial aleatorio para que no siempre empiecen en 0
    const offset = Math.random() * step;

    artistTracks.forEach((track, i) => {
      // Pequeño ruido (jitter) para evitar colisiones exactas
      const jitter = Math.random() * 0.2;
      let sortKey = offset + (i * step) + jitter;

      // Penalización basada en el historial reciente
      if (history.length > 0) {
        const historyIndex = history.indexOf(track.id);
        if (historyIndex !== -1) {
          // Factor de recencia (0 a 1), donde 1 es la más recientemente escuchada
          const recencyFactor = (historyIndex + 1) / history.length;
          // Desplaza la canción hacia el final de la cola (hasta el 70% de la longitud total de la cola)
          const penalty = recencyFactor * tracks.length * 0.7;
          sortKey += penalty;
        }
      }

      spreadList.push({
        track,
        sortKey
      });
    });
  }

  // 4. Ordenar por el sortKey distribuido
  spreadList.sort((a, b) => a.sortKey - b.sortKey);
  return spreadList.map(item => item.track);
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  coverArt?: string;
  urlPath: string; // url para stream local
  filePath?: string; // Ruta local para la carátula
  lyrics?: string;
  syncedLyrics?: string;
  canvasPath?: string;
}

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  isShuffle: boolean;
  loopMode: 'off' | 'all' | 'one';
  playTrack: (track: Track, queue?: Track[]) => void;
  togglePlay: () => void;
  setVolume: (val: number) => void;
  seekTo: (percent: number) => void;
  toggleShuffle: () => void;
  toggleLoop: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  skipNext: () => void;
  skipPrevious: () => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => {
    try {
      const saved = localStorage.getItem('level_player_current_track');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error('Error parsing current track from localStorage:', e);
      return null;
    }
  });
  const [queue, setQueue] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('level_player_queue');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error parsing queue from localStorage:', e);
      return [];
    }
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem('level_player_volume');
    if (saved) {
      const val = parseFloat(saved);
      return isNaN(val) ? 0.8 : val;
    }
    return 0.8;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [progress, setProgress] = useState<number>(() => {
    const saved = localStorage.getItem('level_player_progress');
    if (saved) {
      const val = parseFloat(saved);
      return isNaN(val) ? 0 : val;
    }
    return 0;
  });
  const [duration, setDuration] = useState<number>(() => {
    const saved = localStorage.getItem('level_player_duration');
    if (saved) {
      const val = parseFloat(saved);
      return isNaN(val) ? 0 : val;
    }
    return 0;
  });
  const [isShuffle, setIsShuffle] = useState<boolean>(() => {
    const saved = localStorage.getItem('level_player_is_shuffle');
    return saved === 'true';
  });
  const [shuffledQueue, setShuffledQueue] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('level_player_shuffled_queue');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error parsing shuffled queue from localStorage:', e);
      return [];
    }
  });
  const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>(() => {
    const saved = localStorage.getItem('level_player_loop_mode');
    return (saved === 'all' || saved === 'one' || saved === 'off') ? saved : 'off';
  });

  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('level_player_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error parsing history from localStorage:', e);
      return [];
    }
  });

  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const addToHistory = (trackId: string) => {
    setHistory(prev => {
      const filtered = prev.filter(id => id !== trackId);
      const next = [...filtered, trackId].slice(-50); // Mantener últimas 50 canciones únicas
      localStorage.setItem('level_player_history', JSON.stringify(next));
      return next;
    });
  };
  
  const soundRef = useRef<Howl | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Sync state to localStorage
  useEffect(() => {
    if (currentTrack) {
      localStorage.setItem('level_player_current_track', JSON.stringify(currentTrack));
    } else {
      localStorage.removeItem('level_player_current_track');
    }
  }, [currentTrack]);

  useEffect(() => {
    localStorage.setItem('level_player_queue', JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    localStorage.setItem('level_player_volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('level_player_is_shuffle', isShuffle.toString());
  }, [isShuffle]);

  useEffect(() => {
    localStorage.setItem('level_player_shuffled_queue', JSON.stringify(shuffledQueue));
  }, [shuffledQueue]);

  useEffect(() => {
    localStorage.setItem('level_player_loop_mode', loopMode);
  }, [loopMode]);

  useEffect(() => {
    localStorage.setItem('level_player_duration', duration.toString());
  }, [duration]);

  // Limpiar intervalo
  const clearIntervalSafe = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const playTrack = (track: Track, newQueue?: Track[], startPos: number = 0) => {
    // Si se hace click en la canción actual, pausar/reproducir en vez de reiniciar
    if (currentTrack && currentTrack.id === track.id && soundRef.current && startPos === 0) {
      togglePlay();
      return;
    }

    if (soundRef.current) {
      soundRef.current.unload();
      clearIntervalSafe();
    }
    
    // Limpieza global de Howler para evitar superposición de streams HTML5
    Howler.unload();
    
    if (newQueue) setQueue(newQueue);
    setProgress(startPos);
    localStorage.setItem('level_player_progress', startPos.toString());
    
    addToHistory(track.id);
    
    const streamUrl = `http://localhost:4000${track.urlPath}`;
    let hasSeekedInitial = false;

    const sound = new Howl({
      src: [streamUrl],
      html5: true,
      format: ['flac', 'mp3'],
      volume: volume,
      onplay: () => {
        setIsPlaying(true);
        
        const dur = sound.duration();
        if (dur && dur > 0) {
          setDuration(dur);
        }

        // Seek to initial position on the first play event
        if (startPos > 0 && !hasSeekedInitial) {
          hasSeekedInitial = true;
          sound.seek(startPos);
        }

        // Iniciar tracker de progreso
        clearIntervalSafe();
        let lastSaveTime = 0;
        intervalRef.current = window.setInterval(() => {
          if (sound.playing()) {
            const pos = sound.seek() as number;
            setProgress(pos);
            
            const now = Date.now();
            if (now - lastSaveTime >= 1000) {
              localStorage.setItem('level_player_progress', pos.toString());
              lastSaveTime = now;
            }
            
            const currentDur = sound.duration();
            if (currentDur && currentDur > 0 && currentDur !== durationRef.current) {
              setDuration(currentDur);
            }
          }
        }, 150);
      },
      onpause: () => setIsPlaying(false),
      onend: () => {
        setIsPlaying(false);
        clearIntervalSafe();
        safeHandleTrackEnd();
      },
      onloaderror: (_id, err) => console.error("Error loading track", err),
      onload: () => {
        const dur = sound.duration();
        if (dur && dur > 0) {
          setDuration(dur);
        }
        
        // Fallback seek inside onload if needed, but onplay is primary
        if (startPos > 0 && !hasSeekedInitial) {
          hasSeekedInitial = true;
          sound.seek(startPos);
        }
      }
    });

    soundRef.current = sound;
    setCurrentTrack(track);
    sound.play();
  };


  // Para evitar el stale closure del onend de Howl, usamos useEffect para bindear un handler "limpio"
  // o lo manejamos directamente con referencias.
  const loopModeRef = useRef(loopMode);
  const isShuffleRef = useRef(isShuffle);
  const queueRef = useRef(queue);
  const shuffledQueueRef = useRef(shuffledQueue);
  const currentTrackRef = useRef(currentTrack);
  const durationRef = useRef(duration);

  useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { shuffledQueueRef.current = shuffledQueue; }, [shuffledQueue]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Reescribir handleTrackEnd usando refs y la cola activa
  const safeHandleTrackEnd = () => {
    const lMode = loopModeRef.current;
    const cTrack = currentTrackRef.current;
    const activeQueue = isShuffleRef.current ? shuffledQueueRef.current : queueRef.current;

    if (!cTrack || activeQueue.length === 0) return;

    if (lMode === 'one') {
      playTrack(cTrack, queueRef.current); // Repetir la misma, la cola base no importa aquí
      return;
    }

    const idx = activeQueue.findIndex(t => t.id === cTrack.id);
    if (idx >= 0 && idx < activeQueue.length - 1) {
      playTrack(activeQueue[idx + 1], queueRef.current);
    } else if (idx === activeQueue.length - 1 && lMode === 'all') {
      playTrack(activeQueue[0], queueRef.current);
    }
  };

  // Parchear onend original
  useEffect(() => {
    if (soundRef.current) {
      soundRef.current.off('end');
      soundRef.current.on('end', () => {
        setIsPlaying(false);
        clearIntervalSafe();
        safeHandleTrackEnd();
      });
    }
  }, [currentTrack]); // re-bindear cada vez que cambia el track para tener el scope fresco si fuese necesario

  const togglePlay = () => {
    if (!soundRef.current) {
      if (currentTrack) {
        playTrack(currentTrack, queue, progress);
      }
      return;
    }
    if (isPlaying) {
      soundRef.current.pause();
    } else {
      soundRef.current.play();
    }
  };

  const setVolume = (val: number) => {
    setVolumeState(val);
    if (soundRef.current) {
      soundRef.current.volume(val);
    }
  };

  const seekTo = (percent: number) => {
    if (soundRef.current && duration > 0) {
      const newPos = percent * duration;
      soundRef.current.seek(newPos);
      setProgress(newPos);
      localStorage.setItem('level_player_progress', newPos.toString());
    }
  };

  const toggleShuffle = () => {
    const nextShuffle = !isShuffle;
    setIsShuffle(nextShuffle);
    
    if (nextShuffle && queue.length > 0) {
      // Generar cola aleatoria distribuida usando el historial reciente
      let shuffled = distributeShuffle(queue, historyRef.current);
      
      // Mover la canción actual al principio de la cola mezclada para que siga fluyendo naturalmente
      if (currentTrack) {
        const cId = currentTrack.id;
        shuffled = [currentTrack, ...shuffled.filter(t => t.id !== cId)];
      }
      setShuffledQueue(shuffled);
    }
  };

  // Mantener la cola mezclada en sincronía si la cola original o el modo aleatorio cambian
  useEffect(() => {
    if (isShuffle && queue.length > 0) {
      const queueIds = new Set(queue.map(t => t.id));
      const shuffledIds = new Set(shuffledQueue.map(t => t.id));
      
      const isDifferent = queue.length !== shuffledQueue.length || 
        [...queueIds].some(id => !shuffledIds.has(id));
      
      if (isDifferent) {
        let shuffled = distributeShuffle(queue, historyRef.current);
        if (currentTrack && queueIds.has(currentTrack.id)) {
          shuffled = [currentTrack, ...shuffled.filter(t => t.id !== currentTrack.id)];
        }
        setShuffledQueue(shuffled);
      }
    }
  }, [queue, isShuffle]);
  
  const toggleLoop = () => {
    setLoopMode(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
  };

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  const skipNext = () => {
    safeHandleTrackEnd(); // Hace exactamente lo mismo que el skip!
  };

  const skipPrevious = () => {
    const cTrack = currentTrackRef.current;
    const activeQueue = isShuffleRef.current ? shuffledQueueRef.current : queueRef.current;
    if (!cTrack || activeQueue.length === 0) return;
    
    // Si han pasado más de 3 segundos, reiniciar la canción en vez de ir a la anterior
    if (soundRef.current && (soundRef.current.seek() as number) > 3) {
      soundRef.current.seek(0);
      return;
    }

    const idx = activeQueue.findIndex(t => t.id === cTrack.id);
    if (idx > 0) {
      playTrack(activeQueue[idx - 1], queueRef.current);
    } else if (idx === 0 && loopModeRef.current === 'all') {
      playTrack(activeQueue[activeQueue.length - 1], queueRef.current);
    }
  };

  return (
    <PlayerContext.Provider value={{
      currentTrack, isPlaying, volume, progress, duration, isShuffle, loopMode,
      playTrack, togglePlay, setVolume, seekTo, toggleShuffle, toggleLoop,
      isFullscreen, toggleFullscreen, skipNext, skipPrevious
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
};
