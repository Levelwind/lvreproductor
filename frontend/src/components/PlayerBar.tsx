import { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2, Mic2, ListMusic, Maximize2, Music } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import './PlayerBar.css';

export function PlayerBar() {
  const { 
    currentTrack, isPlaying, togglePlay, toggleFullscreen, 
    skipNext, skipPrevious, volume, setVolume,
    progress, duration, seekTo,
    isShuffle, toggleShuffle, loopMode, toggleLoop
  } = usePlayer();

  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    setCoverError(false);
  }, [currentTrack?.id]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <footer className="player-bar">
      <div className="player-left" onClick={toggleFullscreen} style={{ cursor: 'pointer', position: 'relative' }} title="Expandir reproductor">
        <div className="mini-cover" style={{ overflow: 'hidden', position: 'relative' }}>
          {coverError || !currentTrack ? (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-bg-elevated)',
              color: 'var(--color-text-secondary)'
            }}>
              <Music size={16} style={{ opacity: 0.4 }} />
            </div>
          ) : (
            <img 
              key={currentTrack.id}
              src={`http://localhost:4000/api/cover?path=${encodeURIComponent(currentTrack.filePath || '')}`}
              alt="cover"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={() => setCoverError(true)}
            />
          )}
          <div className="expand-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
            <Maximize2 size={16} color="white" />
          </div>
        </div>
        <div className="player-track-info">
          <span className="player-track-title">{currentTrack?.title || 'Sin seleccionar'}</span>
          <span className="player-track-artist">{currentTrack?.artist || '-'}</span>
        </div>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button className="btn-control" onClick={toggleShuffle} style={{ color: isShuffle ? 'var(--color-brand)' : 'currentColor' }}>
            <Shuffle size={18} />
          </button>
          <button className="btn-control" onClick={skipPrevious}><SkipBack size={20} fill="currentColor" /></button>
          <button className="btn-play" onClick={togglePlay}>
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }}/>}
          </button>
          <button className="btn-control" onClick={skipNext}><SkipForward size={20} fill="currentColor" /></button>
          <button className="btn-control" onClick={toggleLoop} style={{ color: loopMode !== 'off' ? 'var(--color-brand)' : 'currentColor', position: 'relative' }}>
            <Repeat size={18} />
            {loopMode === 'one' && <span style={{ position: 'absolute', fontSize: '10px', top: -4, right: -4, fontWeight: 'bold' }}>1</span>}
          </button>
        </div>
        <div className="waveform-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', width: '40px', textAlign: 'right' }}>
            {formatTime(progress)}
          </span>
          <div 
            className="waveform-progress" 
            style={{ flex: 1, height: '4px', background: 'var(--color-bg-elevated)', borderRadius: '2px', cursor: 'pointer', position: 'relative' }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              seekTo(Math.max(0, Math.min(1, percent)));
            }}
          >
            <div style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%`, height: '100%', background: 'var(--color-brand)', borderRadius: '2px' }}></div>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', width: '40px' }}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="player-right">
        <button className="btn-control"><Mic2 size={18} /></button>
        <button className="btn-control"><ListMusic size={18} /></button>
        <button className="btn-control"><Volume2 size={18} /></button>
        <div className="volume-bar" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const val = (e.clientX - rect.left) / rect.width;
          setVolume(val);
        }}>
          <div className="volume-level" style={{ width: `${volume * 100}%` }}></div>
        </div>
        <button className="btn-control" onClick={toggleFullscreen}><Maximize2 size={18} /></button>
      </div>
    </footer>
  );
}
