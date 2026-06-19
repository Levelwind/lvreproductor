import { useState, useEffect, useRef } from 'react';
import { type Track } from '../context/PlayerContext';

interface LyricsSyncPanelProps {
  tracks: Track[];
  onSyncFinished: () => void;
}

export function LyricsSyncPanel({ tracks, onSyncFinished }: LyricsSyncPanelProps) {
  const [syncMode, setSyncMode] = useState<'missing' | 'unsynced' | 'all'>('missing');
  const [syncProgress, setSyncProgress] = useState<any>(null);
  const wasSyncingRef = useRef(false);

  // Polling para sincronización masiva de letras
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const checkStatus = () => {
      fetch('http://localhost:4000/api/lyrics/sync-status')
        .then(res => res.json())
        .then(data => {
          setSyncProgress(data);
          
          if (!data.running && wasSyncingRef.current) {
            // Acaba de terminar la sincronización, recargamos la biblioteca para actualizar conteos
            onSyncFinished();
          }
          wasSyncingRef.current = !!data.running;
        })
        .catch(() => {});
    };

    checkStatus();
    interval = setInterval(checkStatus, 1500);

    return () => clearInterval(interval);
  }, [onSyncFinished]);

  const handleStartSync = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/lyrics/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: syncMode })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Error al iniciar la sincronización');
      }
    } catch (e) {
      alert('Error de conexión');
    }
  };

  const handleStopSync = async () => {
    try {
      await fetch('http://localhost:4000/api/lyrics/sync-stop', {
        method: 'POST'
      });
    } catch (e) {
      alert('Error de conexión');
    }
  };

  // Cálculo de canciones para los selectores
  const missingCount = tracks.filter(t => !t.lyrics && !t.syncedLyrics).length;
  const unsyncedCount = tracks.filter(t => !t.syncedLyrics || !/\[\d{2}:\d{2}/.test(t.syncedLyrics || '')).length;

  return (
    <div className="settings-section" style={{ marginTop: '40px', borderTop: '1px solid var(--color-border)', paddingTop: '30px' }}>
      <h2>Sincronizador Masivo de Letras</h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
        Busca y descarga letras sincronizadas (formato LRC) para toda tu biblioteca usando LRCLIB (gratuito). 
        <span style={{ display: 'block', fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>Nota: La sincronización de Spotify está desactivada temporalmente en la aplicación.</span>
      </p>

      {syncProgress && syncProgress.running ? (
        <div style={{ backgroundColor: 'var(--color-bg-elevated)', padding: '20px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: 'bold', color: 'var(--color-brand)' }}>Sincronizando letras...</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {syncProgress.processed} / {syncProgress.total} ({Math.round((syncProgress.processed / (syncProgress.total || 1)) * 100)}%)
            </span>
          </div>

          <div style={{ background: 'var(--color-border)', borderRadius: '4px', overflow: 'hidden', height: '8px', marginBottom: '16px' }}>
            <div style={{ height: '100%', width: `${(syncProgress.processed / (syncProgress.total || 1)) * 100}%`, background: 'var(--color-brand)', transition: 'width 0.3s ease' }}></div>
          </div>

          <p style={{ margin: '0 0 16px 0', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>
            <strong>Canción actual:</strong> {syncProgress.currentTrack || 'Iniciando...'}
          </p>

          <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
            <span>✅ Encontradas: <strong style={{ color: 'white' }}>{syncProgress.synced}</strong></span>
            <span>❌ Fallidas: <strong style={{ color: 'white' }}>{syncProgress.failed}</strong></span>
          </div>

          <button className="btn-secondary" onClick={handleStopSync} style={{ backgroundColor: '#e91e63', color: 'white', border: 'none', borderRadius: '4px', padding: '10px 16px', fontWeight: 'bold', cursor: 'pointer' }}>
            Detener Sincronización
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <label style={{ margin: 0, fontWeight: 'normal', color: 'var(--color-text-secondary)', minWidth: '150px' }}>Modo de búsqueda:</label>
            <select 
              value={syncMode} 
              onChange={e => setSyncMode(e.target.value as any)}
              style={{
                background: 'var(--color-bg-elevated)',
                color: 'white',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                padding: '8px 12px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="missing">Sólo canciones sin letras ({missingCount})</option>
              <option value="unsynced">Sin letras sincronizadas ({unsyncedCount})</option>
              <option value="all">Todas las canciones ({tracks.length})</option>
            </select>
          </div>

          <button className="btn-primary" onClick={handleStartSync} style={{ maxWidth: '240px' }}>
            Iniciar Sincronización
          </button>

          {syncProgress && syncProgress.total > 0 && !syncProgress.running && (
            <div style={{ marginTop: '10px', padding: '12px', backgroundColor: 'rgba(29, 185, 84, 0.1)', borderRadius: '6px', border: '1px solid var(--color-brand)' }}>
              <p style={{ margin: 0, color: 'white', fontSize: '14px' }}>
                🎉 Última sincronización completada: Sincronizadas: <strong>{syncProgress.synced}</strong>, Fallidas: <strong>{syncProgress.failed}</strong> de <strong>{syncProgress.total}</strong> canciones.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
