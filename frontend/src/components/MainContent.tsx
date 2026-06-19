import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Settings } from 'lucide-react';
import { Logo } from './Logo';
import { usePlayer, type Track, getApiBase } from '../context/PlayerContext';
import { TrackTable } from './TrackTable';
import { DownloadPanel } from './DownloadPanel';
import { SettingsPanel } from './SettingsPanel';
import './MainContent.css';

interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}


const PLAYLIST_SELECTED_EVENT = 'level-player-playlist-selected';
const LIBRARY_UPDATED_EVENT = 'level-player-library-updated';

export function MainContent() {
  const [activeTab, setActiveTab] = useState<'music' | 'download' | 'settings'>('music');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [totalTracks, setTotalTracks] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  const {
    playTrack,
    currentTrack,
    togglePlay,
    skipNext,
    skipPrevious,
    toggleShuffle,
    toggleLoop,
    isFullscreen,
    toggleFullscreen
  } = usePlayer();

  const [config, setConfig] = useState<any>(null);

  // Debounce para evitar llamadas innecesarias al backend mientras se escribe
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const reloadLibrary = useCallback(() => {
    setIsLoading(true);
    const query = new URLSearchParams({
      limit: '100',
      offset: '0',
      ...(debouncedSearchQuery ? { q: debouncedSearchQuery } : {}),
      ...(selectedPlaylistId ? { playlistId: selectedPlaylistId } : {})
    });

    fetch(`${getApiBase()}/api/library?${query}`)
      .then(res => res.json())
      .then((data: any) => {
         if (data.tracks) {
           setTracks(data.tracks);
         }
         setTotalTracks(data.total || 0);
         setPlaylists(data.playlists || []);
         setIsLoading(false);
       })
      .catch(err => {
         console.error('Error cargando biblioteca:', err);
         setIsLoading(false);
       });
   }, [debouncedSearchQuery, selectedPlaylistId]);

   useEffect(() => {
     reloadLibrary();
   }, [reloadLibrary]);

   useEffect(() => {
     fetch(`${getApiBase()}/api/config`)
       .then(res => res.json())
       .then(data => setConfig(data))
       .catch(err => console.error('Error cargando config:', err));
   }, []);

   const loadMoreTracks = useCallback(() => {
     if (isLoading || tracks.length >= totalTracks) return;
     setIsLoading(true);

     const query = new URLSearchParams({
       limit: '100',
       offset: tracks.length.toString(),
       ...(debouncedSearchQuery ? { q: debouncedSearchQuery } : {}),
       ...(selectedPlaylistId ? { playlistId: selectedPlaylistId } : {})
     });

     fetch(`${getApiBase()}/api/library?${query}`)
       .then(res => res.json())
       .then((data: any) => {
         if (data.tracks) {
           setTracks(prev => [...prev, ...data.tracks]);
         }
         setTotalTracks(data.total || 0);
         setIsLoading(false);
       })
       .catch(err => {
         console.error('Error cargando más canciones:', err);
         setIsLoading(false);
       });
   }, [isLoading, tracks.length, totalTracks, debouncedSearchQuery, selectedPlaylistId]);

   // Manejar el scroll infinito
   useEffect(() => {
     const handleScroll = () => {
       const container = contentAreaRef.current;
       if (!container || isLoading || tracks.length >= totalTracks) return;

       const { scrollTop, scrollHeight, clientHeight } = container;
       if (scrollHeight - scrollTop - clientHeight < 300) {
         loadMoreTracks();
       }
     };

     const container = contentAreaRef.current;
     if (container) {
       container.addEventListener('scroll', handleScroll);
     }
     return () => {
       if (container) {
         container.removeEventListener('scroll', handleScroll);
       }
     };
   }, [isLoading, tracks.length, totalTracks, loadMoreTracks]);

   useEffect(() => {
     const handlePlaylistSelected = (event: Event) => {
       const playlistId = (event as CustomEvent<{ playlistId: string | null }>).detail?.playlistId || null;
       setSelectedPlaylistId(playlistId);
       setActiveTab('music');
       setSearchQuery('');
     };

     window.addEventListener(PLAYLIST_SELECTED_EVENT, handlePlaylistSelected);
     window.addEventListener(LIBRARY_UPDATED_EVENT, reloadLibrary);
     return () => {
       window.removeEventListener(PLAYLIST_SELECTED_EVENT, handlePlaylistSelected);
       window.removeEventListener(LIBRARY_UPDATED_EVENT, reloadLibrary);
     };
   }, [reloadLibrary]);

   const selectedPlaylist = useMemo(
     () => playlists.find(playlist => playlist.id === selectedPlaylistId) || null,
     [playlists, selectedPlaylistId]
   );

   const updatePlaylistTracks = useCallback(async (playlist: Playlist, trackIds: string[]) => {
     const res = await fetch(`${getApiBase()}/api/playlists/${playlist.id}`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ trackIds })
     });

    if (!res.ok) throw new Error('No se pudo actualizar la playlist');

    reloadLibrary();
    window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
  }, [reloadLibrary]);

  const addTrackToPlaylist = useCallback(async (track: Track) => {
    if (playlists.length === 0) {
      window.alert('Primero crea una playlist desde el boton + de la biblioteca.');
      return;
    }

    const options = playlists.map((playlist, index) => `${index + 1}. ${playlist.name}`).join('\n');
    const choice = window.prompt(`Agregar "${track.title}" a:\n${options}`);
    if (!choice) return;

    const index = Number.parseInt(choice, 10) - 1;
    const playlist = playlists[index];
    if (!playlist) return;

    if (playlist.trackIds.includes(track.id)) return;

    try {
      await updatePlaylistTracks(playlist, [...playlist.trackIds, track.id]);
    } catch (err) {
      console.error('Error agregando cancion a playlist:', err);
    }
  }, [playlists, updatePlaylistTracks]);

  const removeTrackFromSelectedPlaylist = useCallback(async (track: Track) => {
    if (!selectedPlaylist) return;

    try {
      await updatePlaylistTracks(
        selectedPlaylist,
        selectedPlaylist.trackIds.filter(trackId => trackId !== track.id)
      );
    } catch (err) {
      console.error('Error quitando cancion de playlist:', err);
    }
  }, [selectedPlaylist, updatePlaylistTracks]);

  useEffect(() => {
    setSelectedIndex(tracks.length > 0 ? 0 : -1);
  }, [tracks]);

  useEffect(() => {
    if (selectedIndex >= 0) {
      const elements = document.querySelectorAll('.track-list .library-item');
      const target = elements[selectedIndex];
      if (target) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );

      if (e.key === 'Escape') {
        if (isFullscreen) {
          toggleFullscreen();
          return;
        }
        if (searchQuery) {
          setSearchQuery('');
        }
        if (isTyping && activeEl instanceof HTMLElement) {
          activeEl.blur();
        }
        return;
      }

      if (isTyping) return;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowdown':
        case 'j':
          if (activeTab === 'music' && tracks.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, tracks.length - 1));
          }
          break;
        case 'arrowup':
        case 'k':
          if (activeTab === 'music' && tracks.length > 0) {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
          }
          break;
        case 'enter':
          if (activeTab === 'music' && selectedIndex >= 0 && selectedIndex < tracks.length) {
            e.preventDefault();
            playTrack(tracks[selectedIndex], tracks, 0, selectedPlaylistId);
          }
          break;
        case '/':
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;
        case 'n':
          skipNext();
          break;
        case 'p':
          skipPrevious();
          break;
        case 's':
          toggleShuffle();
          break;
        case 'r':
          toggleLoop();
          break;
        case 'l':
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTab,
    tracks,
    selectedIndex,
    togglePlay,
    playTrack,
    skipNext,
    skipPrevious,
    toggleShuffle,
    toggleLoop,
    toggleFullscreen,
    isFullscreen,
    searchQuery,
    selectedPlaylistId
  ]);

  return (
    <main className="panel main-content">
      <div className="top-bar">
        <Logo />

        <div className="search-box">
          <Search size={20} color="var(--color-text-secondary)" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Que quieres reproducir?"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'music' ? 'active' : ''}`}
            onClick={() => setActiveTab('music')}
          >
            Musica Local
          </button>
          <button
            className={`tab ${activeTab === 'download' ? 'active' : ''}`}
            onClick={() => setActiveTab('download')}
          >
            Descargar
          </button>
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Settings size={16} /> Ajustes
          </button>
        </div>
      </div>

      <div className="content-area" ref={contentAreaRef}>
        {activeTab === 'settings' && config && (
          <SettingsPanel
            config={config}
            setConfig={setConfig}
            tracks={tracks}
            onSyncFinished={reloadLibrary}
          />
        )}

        {activeTab === 'download' && (
          <DownloadPanel onDownloadComplete={reloadLibrary} />
        )}

        {activeTab === 'music' && (
          <TrackTable
            tracks={tracks}
            filteredTracks={tracks}
            searchQuery={searchQuery}
            title={selectedPlaylist?.name || 'Explorar Biblioteca'}
            emptyMessage={selectedPlaylist ? 'Esta playlist todavia no tiene canciones.' : undefined}
            currentTrack={currentTrack}
            playTrack={playTrack}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex}
            canAddToPlaylist={playlists.length > 0}
            isPlaylistView={Boolean(selectedPlaylist)}
            onAddToPlaylist={addTrackToPlaylist}
            onRemoveFromPlaylist={removeTrackFromSelectedPlaylist}
            playlistId={selectedPlaylistId}
          />
        )}
      </div>
    </main>
  );
}
