import { Play } from 'lucide-react';
import { type Track } from '../context/PlayerContext';

interface TrackTableProps {
  tracks: Track[];
  filteredTracks: Track[];
  searchQuery: string;
  currentTrack: Track | null;
  playTrack: (track: Track, playlist: Track[]) => void;
}

export function TrackTable({ 
  tracks, 
  filteredTracks, 
  searchQuery, 
  currentTrack, 
  playTrack 
}: TrackTableProps) {
  return (
    <div>
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '800' }}>Explorar Biblioteca</h1>
      <div className="track-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {tracks.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>Cargando canciones locales...</p>
        ) : filteredTracks.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>No se encontraron coincidencias para "{searchQuery}"</p>
        ) : (
          filteredTracks.map((track, i) => (
            <div 
              key={track.id} 
              className="library-item" 
              onClick={() => playTrack(track, filteredTracks)}
              style={{ 
                display: 'flex', alignItems: 'center', gap: '16px', padding: '12px', 
                backgroundColor: currentTrack?.id === track.id ? 'var(--color-bg-elevated)' : 'transparent',
                borderRadius: '8px', cursor: 'pointer' 
              }}
            >
              <div style={{ width: '32px', color: 'var(--color-text-secondary)', fontWeight: 'bold' }}>{i + 1}</div>
              <div className="item-cover" style={{ width: '40px', height: '40px', position: 'relative', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--color-brand)' }}>
                <img 
                  key={track.id}
                  src={`http://localhost:4000/api/cover?path=${encodeURIComponent(track.filePath || '')}`} 
                  alt="Cover" 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: currentTrack?.id === track.id ? 'rgba(0,0,0,0.4)' : 'transparent' }}>
                  {currentTrack?.id === track.id && <Play size={16} color="#fff" />}
                </div>
              </div>
              <div className="item-info">
                <span className="item-title" style={{ color: currentTrack?.id === track.id ? 'var(--color-brand)' : 'white' }}>
                  {track.title}
                </span>
                <span className="item-subtitle">{track.artist}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
