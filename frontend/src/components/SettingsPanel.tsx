import { type Track } from '../context/PlayerContext';
import { LyricsSyncPanel } from './LyricsSyncPanel';

interface SettingsPanelProps {
  config: any;
  setConfig: (config: any) => void;
  tracks: Track[];
  onSyncFinished: () => void;
}

export function SettingsPanel({ config, setConfig, tracks, onSyncFinished }: SettingsPanelProps) {

  const handleSaveConfig = async () => {
    try {
      await fetch('http://localhost:4000/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      alert('Configuración guardada correctamente.');
    } catch (err) {
      alert('Error al guardar configuración.');
    }
  };

  return (
    <div className="download-panel">
      <h1>Configuración de Tokens</h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>Maneja tus cookies y tokens para evitar baneos.</p>
      
      <div className="input-group" style={{ marginTop: '20px' }}>
        {/* Spotify sp_dc Cookie — desactivado temporalmente, se conserva el valor en config.json */}
        <label style={{ opacity: 0.45 }}>Spotify sp_dc Cookie <span style={{ fontSize: '11px', fontStyle: 'italic' }}>(desactivado)</span></label>
        <input type="text" className="download-input" 
          value={config.spotify?.sp_dc || ''} 
          onChange={e => setConfig({...config, spotify: {...config.spotify, sp_dc: e.target.value}})}
          disabled
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        />
        
        <label style={{ marginTop: '10px' }}>Tidal Token</label>
        <input type="text" className="download-input" 
          value={config.tidal?.token || ''} 
          onChange={e => setConfig({...config, tidal: {...config.tidal, token: e.target.value}})} 
        />
        
        <label style={{ marginTop: '10px' }}>YouTube Cookie (yt-dlp)</label>
        <input type="text" className="download-input" 
          value={config.youtube?.cookie || ''} 
          onChange={e => setConfig({...config, youtube: {...config.youtube, cookie: e.target.value}})} 
        />

        <button className="btn-primary" onClick={handleSaveConfig} style={{ marginTop: '20px' }}>
          Guardar Cambios
        </button>
      </div>

      <LyricsSyncPanel tracks={tracks} onSyncFinished={onSyncFinished} />
    </div>
  );
}
