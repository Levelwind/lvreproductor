import { useState, useRef, useEffect, useMemo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, Repeat, Shuffle } from 'lucide-react';
import { usePlayer, getApiBase } from '../context/PlayerContext';
import { useColorExtractor } from '../hooks/useColorExtractor';
import { useLyrics } from '../hooks/useLyrics';
import './FullscreenPlayer.css';

interface SyncedLine {
  time: number;
  text: string;
}

function parseLRC(lrc: string): SyncedLine[] {
  const lines = lrc.split('\n');
  const result: SyncedLine[] = [];
  const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const ms = parseFloat('0.' + msStr);
      
      const time = minutes * 60 + seconds + ms;
      const text = line.replace(timeRegex, '').trim();
      // Only add non-empty lyric lines so that they remain highlighted during instrumental gaps/pauses
      if (text.length > 0) {
        result.push({ time, text });
      }
    }
  }

  const sorted = result.sort((a, b) => a.time - b.time);
  
  // If the first lyric line starts after 4 seconds, prepend an instrumental intro line
  if (sorted.length > 0 && sorted[0].time > 4) {
    sorted.unshift({ time: 0, text: "♫ (Instrumental)" });
  }

  return sorted;
}


export function FullscreenPlayer() {
  const { 
    currentTrack, 
    isPlaying, 
    togglePlay, 
    toggleFullscreen,
    skipNext,
    skipPrevious,
    progress,
    duration,
    seekTo,
    isShuffle,
    toggleShuffle,
    loopMode,
    toggleLoop
  } = usePlayer();

  const [coverVersion, setCoverVersion] = useState(0);
  const [updatingCover, setUpdatingCover] = useState(false);
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    setCoverError(false);
  }, [currentTrack?.id]);

  const coverUrl = currentTrack?.filePath 
    ? `${getApiBase()}/api/cover?path=${encodeURIComponent(currentTrack.filePath)}&v=${coverVersion}` 
    : undefined;

  const activeCoverUrl = (!coverError && coverUrl) ? coverUrl : undefined;
  const { 
    dominantColor, 
    gradientColors, 
    isLightBackground, 
    contrastColor, 
    secondaryContrastColor, 
    textColor, 
    playButtonBg, 
    playButtonText 
  } = useColorExtractor(activeCoverUrl);

  const handleCoverDoubleClick = async () => {
    if (!currentTrack?.filePath || updatingCover) return;
    
    setUpdatingCover(true);
    try {
      const res = await fetch(
        `${getApiBase()}/api/cover?path=${encodeURIComponent(currentTrack.filePath)}&force_search=true`
      );
      if (res.ok) {
        setCoverVersion(prev => prev + 1);
      } else {
        alert('No se pudo encontrar una mejor carátula en internet.');
      }
    } catch (e) {
      console.error(e);
      alert('Error de conexión al buscar carátula.');
    } finally {
      setUpdatingCover(false);
    }
  };


  const { lyrics: onlineLyrics, loading, error } = useLyrics(
    currentTrack?.artist,
    currentTrack?.title,
    currentTrack?.filePath
  );

  const rawLyrics = currentTrack?.syncedLyrics || currentTrack?.lyrics || onlineLyrics;

  const isSynced = useMemo(() => {
    return !!rawLyrics && /\[\d+:\d+(?:\.\d+)?\]/.test(rawLyrics);
  }, [rawLyrics]);

  const parsedLyrics = useMemo(() => {
    if (!rawLyrics || !isSynced) return null;
    return parseLRC(rawLyrics);
  }, [rawLyrics, isSynced]);

  const activeLineIndex = useMemo(() => {
    if (!parsedLyrics || parsedLyrics.length === 0) return -1;
    
    let activeIdx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (progress >= parsedLyrics[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }
    return activeIdx;
  }, [parsedLyrics, progress]);

  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const handleLineClick = (time: number) => {
    if (duration > 0) {
      seekTo(time / duration);
    }
  };

  // Reset scroll to top when track changes
  useEffect(() => {
    if (lyricsContainerRef.current) {
      lyricsContainerRef.current.scrollTop = 0;
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (isSynced && activeLineIndex !== -1 && lyricsContainerRef.current) {
      const container = lyricsContainerRef.current;
      const activeEl = container.querySelector(`.lyric-line[data-index="${activeLineIndex}"]`) as HTMLElement;
      if (activeEl) {
        // Calcular la posición ideal para centrar la línea activa de la letra
        const targetScrollTop = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
        
        const start = container.scrollTop;
        const change = targetScrollTop - start;
        const duration = 350; // milisegundos para una sensación ágil y fluida
        let startTime: number | null = null;
        let animationFrameId: number;

        const animateScroll = (timestamp: number) => {
          if (!startTime) startTime = timestamp;
          const elapsed = timestamp - startTime;
          const progress = Math.min(elapsed / duration, 1);
          
          // Curva de desaceleración Cubic Ease-Out
          const ease = 1 - Math.pow(1 - progress, 3);
          
          container.scrollTop = start + change * ease;
          
          if (progress < 1) {
            animationFrameId = requestAnimationFrame(animateScroll);
          }
        };
        
        animationFrameId = requestAnimationFrame(animateScroll);
        
        return () => {
          cancelAnimationFrame(animationFrameId);
        };
      }
    }
  }, [activeLineIndex, isSynced]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const renderLyrics = () => {
    if (loading) return <p style={{ opacity: 0.5, fontSize: '24px' }}>Buscando letras...</p>;
    
    if (error || !rawLyrics) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ opacity: 0.5, fontSize: '24px', marginBottom: '24px' }}>Letras no disponibles para esta canción.</p>
        </div>
      );
    }

    if (isSynced && parsedLyrics && parsedLyrics.length > 0) {
      return parsedLyrics.map((line, idx) => {
        const isActive = idx === activeLineIndex;
        return (
          <p 
            key={idx} 
            className={`lyric-line ${isActive ? 'active' : ''}`}
            data-index={idx}
            onClick={() => handleLineClick(line.time)}
            style={{ 
              cursor: 'pointer',
              color: isActive 
                ? contrastColor 
                : (isLightBackground ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.3)'),
              textShadow: 'none'
            }}
          >
            {line.text}
          </p>
        );
      });
    }

    const lines = rawLyrics.split('\n');
    return (
      <div className="plain-lyrics-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', textAlign: 'center', width: '100%' }}>
        <p className="lyric-status-badge" style={{ fontSize: '14px', opacity: 0.4, fontWeight: 'normal', margin: '0 0 16px 0', letterSpacing: '2px', textTransform: 'uppercase' }}>Letras no sincronizadas</p>
        {lines.map((line, idx) => (
          <p 
            key={idx} 
            style={{ 
              opacity: 0.85, 
              fontSize: '22px', 
              fontWeight: '600', 
              color: isLightBackground ? '#0a0a0c' : '#ffffff', 
              margin: '0', 
              lineHeight: '1.4',
              width: '100%'
            }}
          >
            {line.trim() === '' ? '\u00A0' : line}
          </p>
        ))}
      </div>
    );
  };

  const overlayBackground = isLightBackground
    ? `linear-gradient(to top, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.3) 40%, rgba(255, 255, 255, 0) 80%), linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 25%), linear-gradient(135deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)`
    : `linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.3) 40%, rgba(0, 0, 0, 0) 80%), linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0) 25%), linear-gradient(135deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)`;

  return (
    <div 
      className="fullscreen-overlay" 
      style={{ 
        background: overlayBackground,
        color: textColor
      }}
    >
      <div className="fs-header">
        <button 
          className="btn-icon" 
          onClick={toggleFullscreen} 
          style={{ 
            width: '40px', 
            height: '40px',
            backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)',
            borderColor: isLightBackground ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.2)',
            color: textColor
          }}
        >
          <X size={24} />
        </button>
      </div>

      <div className="fs-content">
        <div className="fs-visualizer">
          <div 
            className="fs-cover-container" 
            onDoubleClick={handleCoverDoubleClick}
            title="Doble click para buscar una mejor carátula en internet"
            style={{ cursor: 'pointer', position: 'relative' }}
          >
            <img 
              key={currentTrack?.id || 'default'}
              className={`fs-cover ${isPlaying ? 'playing' : ''}`} 
              src={(!coverError && coverUrl) ? coverUrl : 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=400'} 
              alt="Cover" 
              style={{ boxShadow: `0 20px 50px rgba(0,0,0,0.5), 0 0 40px ${dominantColor}` }}
              onError={() => setCoverError(true)}
            />
            {updatingCover && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', borderRadius: '0px', color: 'white', fontWeight: 'bold', fontSize: '14px', textAlign: 'center', padding: '16px' }}>
                Buscando mejor carátula...
              </div>
            )}
          </div>
        </div>

        <div className="fs-lyrics" ref={lyricsContainerRef}>
          <div className="lyrics-container">
            {renderLyrics()}
          </div>
        </div>
      </div>

      <div className="fs-controls">
        <div className="fs-track-info">
          <h2 style={{ color: textColor }}>{currentTrack?.title || 'Sin seleccionar'}</h2>
          <p style={{ color: secondaryContrastColor }}>{currentTrack?.artist || '-'}</p>
        </div>

        <div className="fs-progress-container">
          <span className="fs-time" style={{ color: secondaryContrastColor }}>{formatTime(progress)}</span>
          <div className="fs-progress-bar-wrapper">
            <div 
              className="fs-progress-bar"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                seekTo(Math.max(0, Math.min(1, percent)));
              }}
              style={{ 
                backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.25)' 
              }}
            >
              <div 
                className="fs-progress-fill" 
                style={{ 
                  width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                  backgroundColor: contrastColor
                }}
              ></div>
            </div>
          </div>
          <span className="fs-time" style={{ color: secondaryContrastColor }}>{formatTime(duration)}</span>
        </div>

        <div className="player-controls fs-main-controls">
          <button 
            className="btn-control" 
            onClick={toggleShuffle} 
            style={{ color: isShuffle ? contrastColor : secondaryContrastColor }}
          >
            <Shuffle size={16} />
          </button>
          <button 
            className="btn-control" 
            onClick={skipPrevious} 
            style={{ color: secondaryContrastColor }}
          >
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button 
            className="btn-play fs-play-btn" 
            onClick={togglePlay}
            style={{ 
              backgroundColor: playButtonBg, 
              color: playButtonText,
              boxShadow: isLightBackground ? '0 10px 30px rgba(0,0,0,0.15)' : '0 10px 30px rgba(255,255,255,0.1)'
            }}
          >
            {isPlaying ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor" style={{ marginLeft: '1px' }}/>}
          </button>
          <button 
            className="btn-control" 
            onClick={skipNext} 
            style={{ color: secondaryContrastColor }}
          >
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button 
            className="btn-control" 
            onClick={toggleLoop} 
            style={{ 
              color: loopMode !== 'off' ? contrastColor : secondaryContrastColor, 
              position: 'relative' 
            }}
          >
            <Repeat size={16} />
            {loopMode === 'one' && <span style={{ position: 'absolute', fontSize: '10px', top: -4, right: -4, fontWeight: 'bold' }}>1</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
