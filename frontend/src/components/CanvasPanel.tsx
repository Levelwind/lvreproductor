import { MoreHorizontal, Video, Music } from 'lucide-react';
import { useState, useEffect } from 'react';
import { usePlayer, getApiBase } from '../context/PlayerContext';
import './CanvasPanel.css';

export function CanvasPanel() {
  const { currentTrack } = usePlayer();
  const [showVideo, setShowVideo] = useState(true);
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    setCoverError(false);
  }, [currentTrack?.id]);

  const coverUrl = currentTrack?.filePath
    ? `${getApiBase()}/api/cover?path=${encodeURIComponent(currentTrack.filePath)}`
    : 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=400';

  const canvasUrl = currentTrack?.canvasPath
    ? `${getApiBase()}/api/stream?path=${encodeURIComponent(currentTrack.canvasPath)}`
    : null;

  const isMp4Canvas = currentTrack?.canvasPath?.endsWith('.mp4');
  const isJpgCanvas = currentTrack?.canvasPath?.endsWith('.jpg') || currentTrack?.canvasPath?.endsWith('.jpeg');

  return (
    <aside className="panel canvas-panel">
      <div className="canvas-header">
        <h3>Ahora suena</h3>
        <button className="btn-icon">
          <MoreHorizontal size={20} />
        </button>
      </div>

      <div className="album-cover-container" style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px', aspectRatio: '1/1' }}>
        {/* Cover art image (fallback / standard cover art) */}
        {!(showVideo && canvasUrl) && (
          coverError || !currentTrack ? (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--color-bg-elevated) 0%, #18181c 100%)',
              color: 'var(--color-text-secondary)',
              gap: '12px'
            }}>
              <Music size={48} style={{ opacity: 0.4 }} />
            </div>
          ) : (
            <img 
              key={currentTrack.id}
              className="album-cover" 
              src={coverUrl} 
              alt="Cover Art" 
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover',
                display: 'block' 
              }} 
              onError={() => setCoverError(true)}
            />
          )
        )}
        
        {/* Dynamic Canvas Video */}
        {showVideo && canvasUrl && isMp4Canvas && (
          <video 
            className="video-canvas"
            src={canvasUrl} 
            autoPlay 
            loop 
            muted 
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
          />
        )}

        {/* Dynamic Canvas Image */}
        {showVideo && canvasUrl && isJpgCanvas && (
          <img 
            className="video-canvas"
            src={canvasUrl} 
            alt="Canvas"
            style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
          />
        )}
      </div>

      <div className="track-details">
        <span className="track-title">{currentTrack?.title || 'Sin seleccionar'}</span>
        <span className="track-artist">{currentTrack?.artist || '-'}</span>
      </div>

      {canvasUrl && (
        <button 
          className="btn-toggle-video"
          onClick={() => setShowVideo(!showVideo)}
        >
          <Video size={18} />
          {showVideo ? 'Apagar Canvas' : 'Encender Canvas'}
        </button>
      )}
    </aside>
  );
}
