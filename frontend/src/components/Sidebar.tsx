import { useEffect, useState } from 'react';
import { Library, Music, Plus, Trash2 } from 'lucide-react';
import { getApiBase } from '../context/PlayerContext';
import './Sidebar.css';

interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

interface LibraryResponse {
  playlists?: Playlist[];
}

const PLAYLIST_SELECTED_EVENT = 'level-player-playlist-selected';
const LIBRARY_UPDATED_EVENT = 'level-player-library-updated';

export function Sidebar() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const loadPlaylists = () => {
    fetch(`${getApiBase()}/api/library`)
      .then(res => res.json())
      .then((data: LibraryResponse) => setPlaylists(data.playlists || []))
      .catch(err => console.error('Error cargando playlists:', err));
  };

  useEffect(() => {
    loadPlaylists();

    window.addEventListener(LIBRARY_UPDATED_EVENT, loadPlaylists);
    return () => window.removeEventListener(LIBRARY_UPDATED_EVENT, loadPlaylists);
  }, []);

  const selectPlaylist = (playlistId: string | null) => {
    setSelectedPlaylistId(playlistId);
    window.dispatchEvent(new CustomEvent(PLAYLIST_SELECTED_EVENT, {
      detail: { playlistId }
    }));
  };

  const createPlaylist = async () => {
    const name = window.prompt('Nombre de la playlist');
    if (!name?.trim()) return;

    try {
      const res = await fetch(`${getApiBase()}/api/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), trackIds: [] })
      });

      if (!res.ok) throw new Error('No se pudo crear la playlist');

      const playlist = await res.json() as Playlist;
      setPlaylists(prev => [...prev, playlist]);
      selectPlaylist(playlist.id);
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
    } catch (err) {
      console.error('Error creando playlist:', err);
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/playlists/${playlistId}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('No se pudo eliminar la playlist');

      setPlaylists(prev => prev.filter(playlist => playlist.id !== playlistId));
      if (selectedPlaylistId === playlistId) selectPlaylist(null);
      window.dispatchEvent(new Event(LIBRARY_UPDATED_EVENT));
    } catch (err) {
      console.error('Error eliminando playlist:', err);
    }
  };

  return (
    <aside className="panel sidebar">
      <div className="sidebar-header">
        <h2>
          <Library size={24} strokeWidth={2.5} />
          Tu biblioteca
        </h2>
        <button className="btn-icon" onClick={createPlaylist} title="Crear playlist">
          <Plus size={20} strokeWidth={2.5} />
        </button>
      </div>

      <div className="filters">
        <button className="pill-btn">Playlists</button>
        <button className="pill-btn">Artistas</button>
      </div>

      <div className="library-list">
        <div
          className={`library-item ${selectedPlaylistId === null ? 'active' : ''}`}
          onClick={() => selectPlaylist(null)}
        >
          <div className="item-cover playlist-cover" style={{ backgroundColor: 'var(--color-brand)' }}>
            <Music size={20} />
          </div>
          <div className="item-info">
            <span className="item-title">Todas las canciones</span>
            <span className="item-subtitle">Biblioteca local</span>
          </div>
        </div>

        {playlists.map(playlist => (
          <div
            key={playlist.id}
            className={`library-item ${selectedPlaylistId === playlist.id ? 'active' : ''}`}
            onClick={() => selectPlaylist(playlist.id)}
          >
            <div className="item-cover playlist-cover">
              <Music size={20} />
            </div>
            <div className="item-info">
              <span className="item-title">{playlist.name}</span>
              <span className="item-subtitle">Playlist - {playlist.trackIds.length} canciones</span>
            </div>
            <button
              className="btn-icon playlist-delete"
              onClick={(e) => {
                e.stopPropagation();
                deletePlaylist(playlist.id);
              }}
              title="Eliminar playlist"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
