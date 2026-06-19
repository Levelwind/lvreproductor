import { useState, useRef, useEffect } from 'react';
import { Play, Plus, Trash2, AlertCircle } from 'lucide-react';
import { type Track, getApiBase } from '../context/PlayerContext';

interface TrackTableProps {
  tracks: Track[];
  filteredTracks: Track[];
  searchQuery: string;
  title?: string;
  emptyMessage?: string;
  currentTrack: Track | null;
  playTrack: (track: Track, playlist?: Track[] | null, startPos?: number, playlistId?: string | null) => void;
  selectedIndex?: number;
  setSelectedIndex?: (index: number) => void;
  canAddToPlaylist?: boolean;
  isPlaylistView?: boolean;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
  playlistId?: string | null;
}

interface CoverImageProps {
  trackId: string;
  filePath: string;
}

function CoverImage({ trackId, filePath }: CoverImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return null;
  }

  return (
    <img
      key={trackId}
      src={`${getApiBase()}/api/cover?path=${encodeURIComponent(filePath)}`}
      alt="Cover"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={() => setHasError(true)}
    />
  );
}

export function TrackTable({ 
  tracks, 
  filteredTracks, 
  searchQuery, 
  title = 'Explorar Biblioteca',
  emptyMessage,
  currentTrack, 
  playTrack,
  selectedIndex,
  setSelectedIndex,
  canAddToPlaylist = false,
  isPlaylistView = false,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  playlistId
}: TrackTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Auto-descubrimiento del contenedor con scroll (.content-area)
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const scrollParent = element.closest('.content-area');
    if (!scrollParent) return;

    const handleScroll = () => {
      setScrollTop(scrollParent.scrollTop);
      setViewportHeight(scrollParent.clientHeight);
    };

    // Registrar valores iniciales
    setScrollTop(scrollParent.scrollTop);
    setViewportHeight(scrollParent.clientHeight);

    scrollParent.addEventListener('scroll', handleScroll);

    const resizeObserver = new ResizeObserver(() => {
      setViewportHeight(scrollParent.clientHeight);
    });
    resizeObserver.observe(scrollParent);

    return () => {
      scrollParent.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  // Altura aproximada de fila: padding 12px * 2 + cover 40px = 64px.
  // Más la separación de gap: 8px. Total = 72px.
  const rowHeight = 64;
  const rowGap = 8;
  const totalRowHeight = rowHeight + rowGap;

  // Auto-scroll del elemento seleccionado vía teclado
  useEffect(() => {
    if (selectedIndex === undefined || selectedIndex < 0) return;
    const element = containerRef.current;
    if (!element) return;

    const scrollParent = element.closest('.content-area');
    if (!scrollParent) return;

    const itemTop = selectedIndex * totalRowHeight;
    const itemBottom = itemTop + rowHeight;
    const viewTop = scrollParent.scrollTop;
    const viewBottom = viewTop + scrollParent.clientHeight;

    if (itemTop < viewTop) {
      scrollParent.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      scrollParent.scrollTop = itemBottom - scrollParent.clientHeight;
    }
  }, [selectedIndex, totalRowHeight, rowHeight]);

  const totalTracks = filteredTracks.length;
  const totalHeight = totalTracks * totalRowHeight - rowGap;

  // Rango visible con un buffer de 5 filas para un desplazamiento suave
  const buffer = 5;
  const startIndex = Math.max(0, Math.floor(scrollTop / totalRowHeight) - buffer);
  const endIndex = Math.min(totalTracks, Math.ceil((scrollTop + viewportHeight) / totalRowHeight) + buffer);

  const visibleTracks = filteredTracks.slice(startIndex, endIndex);

  const paddingTop = startIndex * totalRowHeight;
  const paddingBottom = Math.max(0, totalHeight - (endIndex * totalRowHeight) + rowGap);

  return (
    <div ref={containerRef}>
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '800' }}>{title}</h1>
      
      <div 
        className="track-list" 
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          paddingTop: `${paddingTop}px`,
          paddingBottom: `${paddingBottom}px`,
          boxSizing: 'border-box'
        }}
      >
        {tracks.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>Cargando canciones locales...</p>
        ) : filteredTracks.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {searchQuery ? `No se encontraron coincidencias para "${searchQuery}"` : emptyMessage || 'No hay canciones para mostrar.'}
          </p>
        ) : (
          visibleTracks.map((track, relativeIndex) => {
            const i = startIndex + relativeIndex;
            return (
              <div 
                key={track.id} 
                className="library-item" 
                onClick={() => {
                  if (track.isUnavailable) return;
                  if (setSelectedIndex) setSelectedIndex(i);
                  playTrack(track, filteredTracks, 0, playlistId);
                }}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '16px', padding: `${rowHeight/2 - 20}px 12px`, 
                  height: `${rowHeight}px`,
                  boxSizing: 'border-box',
                  backgroundColor: currentTrack?.id === track.id ? 'var(--color-bg-elevated)' : 'transparent',
                  borderRadius: '8px', 
                  cursor: track.isUnavailable ? 'not-allowed' : 'pointer',
                  opacity: track.isUnavailable ? 0.4 : 1,
                  boxShadow: selectedIndex === i ? 'inset 0 0 0 1px var(--color-brand)' : 'none'
                }}
              >
                <div style={{ width: '32px', color: 'var(--color-text-secondary)', fontWeight: 'bold' }}>{i + 1}</div>
                <div className="item-cover" style={{ width: '40px', height: '40px', position: 'relative', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--color-brand)' }}>
                  <CoverImage trackId={track.id} filePath={track.filePath || ''} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: currentTrack?.id === track.id ? 'rgba(0,0,0,0.4)' : 'transparent' }}>
                    {currentTrack?.id === track.id && <Play size={16} color="#fff" />}
                  </div>
                </div>
                <div className="item-info" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span className="item-title" style={{ fontWeight: '600', color: currentTrack?.id === track.id ? 'var(--color-brand)' : 'var(--color-text-primary)' }}>
                    {track.title}
                  </span>
                  <span className="item-subtitle">{track.artist}</span>
                </div>
                {track.isUnavailable && (
                  <div title="Archivo no disponible (unidad desconectada)" style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', marginRight: '8px' }}>
                    <AlertCircle size={18} />
                  </div>
                )}
                {isPlaylistView ? (
                  <button
                    className="btn-control"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromPlaylist?.(track);
                    }}
                    title="Quitar de playlist"
                  >
                    <Trash2 size={16} />
                  </button>
                ) : canAddToPlaylist ? (
                  <button
                    className="btn-control"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToPlaylist?.(track);
                    }}
                    title="Agregar a playlist"
                  >
                    <Plus size={16} />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
