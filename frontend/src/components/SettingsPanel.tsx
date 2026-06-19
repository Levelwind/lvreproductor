import { useState } from 'react';
import { type Track, getApiBase } from '../context/PlayerContext';
import { LyricsSyncPanel } from './LyricsSyncPanel';
import { FolderPlus, Trash2, RefreshCw } from 'lucide-react';

interface SettingsPanelProps {
  config: any;
  setConfig: (config: any) => void;
  tracks: Track[];
  onSyncFinished: () => void;
}

export function SettingsPanel({ config, setConfig, tracks, onSyncFinished }: SettingsPanelProps) {
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'finished'>('idle');
  const [scannedCount, setScannedCount] = useState<number | null>(null);

  const handleSaveConfig = async () => {
    try {
      await fetch(`${getApiBase()}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      alert('Configuración guardada correctamente.');
    } catch (err) {
      alert('Error al guardar configuración.');
    }
  };

  const handleAddFolder = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/folders/select`);
      const data = await res.json();
      if (data.path) {
        const currentPaths = config.paths || {};
        const currentFolders = currentPaths.musicFolders || [];
        
        if (currentFolders.includes(data.path)) {
          alert('La carpeta ya está en la lista.');
          return;
        }

        const updatedFolders = [...currentFolders, data.path];
        setConfig({
          ...config,
          paths: {
            ...currentPaths,
            musicFolders: updatedFolders
          }
        });
      }
    } catch (err) {
      console.error('Error al seleccionar carpeta:', err);
      alert('Error al abrir el selector de carpetas.');
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    const currentPaths = config.paths || {};
    const currentFolders = currentPaths.musicFolders || [];
    const updatedFolders = currentFolders.filter((f: string) => f !== folderPath);
    
    setConfig({
      ...config,
      paths: {
        ...currentPaths,
        musicFolders: updatedFolders
      }
    });
  };

  const handleScanLibrary = async () => {
    const folders = config?.paths?.musicFolders || [];
    if (folders.length === 0) {
      alert('Por favor, agrega al menos una carpeta de música antes de escanear.');
      return;
    }

    setScanStatus('scanning');
    try {
      const res = await fetch(`${getApiBase()}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folders })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setScannedCount(data.tracksCount);
        setScanStatus('finished');
        onSyncFinished(); // Recarga la biblioteca en el frontend
      } else {
        throw new Error(data.details || 'Error desconocido');
      }
    } catch (err: any) {
      console.error('Error en escaneo:', err);
      alert(`Error al escanear la biblioteca: ${err.message}`);
      setScanStatus('idle');
    }
  };

  const musicFolders = config?.paths?.musicFolders || [];

  return (
    <div className="download-panel" style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <style>{`
        @keyframes spin-folder {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin-icon-active {
          animation: spin-folder 1.2s linear infinite;
        }
      `}</style>

      <div>
        <h1>Configuración de Tokens</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>Maneja tus cookies y tokens para descargas.</p>
        
        <div className="input-group" style={{ marginTop: '16px' }}>
          <label style={{ opacity: 0.45 }}>Spotify sp_dc Cookie <span style={{ fontSize: '11px', fontStyle: 'italic' }}>(desactivado)</span></label>
          <input type="text" className="download-input" 
            value={config?.spotify?.sp_dc || ''} 
            onChange={e => setConfig({...config, spotify: {...config.spotify, sp_dc: e.target.value}})}
            disabled
            style={{ opacity: 0.4, cursor: 'not-allowed' }}
          />
          
          <label style={{ marginTop: '10px' }}>Tidal Token</label>
          <input type="text" className="download-input" 
            value={config?.tidal?.token || ''} 
            onChange={e => setConfig({...config, tidal: {...config.tidal, token: e.target.value}})} 
          />
          
          <label style={{ marginTop: '10px' }}>YouTube Cookie (yt-dlp)</label>
          <input type="text" className="download-input" 
            value={config?.youtube?.cookie || ''} 
            onChange={e => setConfig({...config, youtube: {...config.youtube, cookie: e.target.value}})} 
          />

          <button className="btn-primary" onClick={handleSaveConfig} style={{ marginTop: '16px' }}>
            Guardar Cambios
          </button>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-bg-elevated)' }} />

      <div>
        <h1>Carpetas de Música</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
          Configura los directorios locales donde el reproductor buscará tus canciones.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {musicFolders.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              No has configurado ninguna carpeta. Agrega una para comenzar.
            </p>
          ) : (
            musicFolders.map((folder: string) => (
              <div 
                key={folder} 
                className="library-item" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '12px', 
                  backgroundColor: 'var(--color-bg-elevated)', 
                  borderRadius: '8px' 
                }}
              >
                <span style={{ fontSize: '14px', wordBreak: 'break-all' }}>{folder}</span>
                <button 
                  className="btn-icon" 
                  onClick={() => handleRemoveFolder(folder)} 
                  title="Eliminar Carpeta"
                  style={{ color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="btn-primary" 
            onClick={handleAddFolder} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '12px 24px', 
              fontSize: '14px', 
              borderRadius: '24px' 
            }}
          >
            <FolderPlus size={16} />
            Agregar Carpeta
          </button>

          <button 
            className="btn-primary" 
            onClick={handleScanLibrary} 
            disabled={scanStatus === 'scanning'}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '12px 24px', 
              fontSize: '14px', 
              borderRadius: '24px',
              backgroundColor: scanStatus === 'scanning' ? 'var(--color-bg-elevated)' : 'var(--color-text-primary)',
              color: scanStatus === 'scanning' ? 'var(--color-text-secondary)' : '#000'
            }}
          >
            <RefreshCw size={16} className={scanStatus === 'scanning' ? 'spin-icon-active' : ''} />
            {scanStatus === 'scanning' ? 'Escaneando...' : 'Sincronizar Biblioteca'}
          </button>
        </div>

        {scanStatus === 'finished' && scannedCount !== null && (
          <p style={{ color: 'var(--color-brand)', fontSize: '14px', marginTop: '12px', fontWeight: 'bold' }}>
            ✓ Escaneo completado. Se indexaron {scannedCount} canciones en total.
          </p>
        )}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-bg-elevated)' }} />

      <LyricsSyncPanel tracks={tracks} onSyncFinished={onSyncFinished} />
    </div>
  );
}
