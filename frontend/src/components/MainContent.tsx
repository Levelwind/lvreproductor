import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Settings } from 'lucide-react';
import { Logo } from './Logo';
import { usePlayer, type Track } from '../context/PlayerContext';
import Fuse from 'fuse.js';
import { TrackTable } from './TrackTable';
import { DownloadPanel } from './DownloadPanel';
import { SettingsPanel } from './SettingsPanel';
import './MainContent.css';

export function MainContent() {
  const [activeTab, setActiveTab] = useState<'music' | 'download' | 'settings'>('music');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const { playTrack, currentTrack } = usePlayer();
  
  // Estados para config
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    fetch('http://localhost:4000/api/library')
      .then(res => res.json())
      .then(data => {
        if (data.tracks) setTracks(data.tracks);
      })
      .catch(err => console.error('Error cargando biblioteca:', err));

    fetch('http://localhost:4000/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Error cargando config:', err));
  }, []);

  // Filtrado difuso (Fuzzy Search) con Fuse.js
  const filteredTracks = useMemo(() => {
    if (!searchQuery.trim()) return tracks;
    const fuse = new Fuse(tracks, {
      keys: ['title', 'artist', 'album'],
      threshold: 0.4, // Un umbral de 0.4 permite errores tipográficos
      ignoreLocation: true
    });
    return fuse.search(searchQuery).map(result => result.item);
  }, [tracks, searchQuery]);

  // Callback para recargar la biblioteca (usado por subcomponentes)
  const reloadLibrary = useCallback(() => {
    fetch('http://localhost:4000/api/library')
      .then(res => res.json())
      .then(data => {
        if (data.tracks) setTracks(data.tracks);
      })
      .catch(err => console.error('Error recargando biblioteca:', err));
  }, []);

  return (
    <main className="panel main-content">
      <div className="top-bar">
        <Logo />
        
        <div className="search-box">
          <Search size={20} color="var(--color-text-secondary)" />
          <input 
            type="text" 
            placeholder="¿Qué quieres reproducir?" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'music' ? 'active' : ''}`}
            onClick={() => setActiveTab('music')}
          >
            Música Local
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

      <div className="content-area">
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
            filteredTracks={filteredTracks}
            searchQuery={searchQuery}
            currentTrack={currentTrack}
            playTrack={playTrack}
          />
        )}
      </div>
    </main>
  );
}
