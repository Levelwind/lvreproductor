import { useState, useEffect } from 'react';
import { DownloadCloud } from 'lucide-react';
import { getApiBase } from '../context/PlayerContext';

interface DownloadPanelProps {
  onDownloadComplete: () => void;
}

export function DownloadPanel({ onDownloadComplete }: DownloadPanelProps) {
  const [url, setUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [downloadMeta, setDownloadMeta] = useState<any>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Autocargar metadatos al pegar enlace o escribir búsqueda (debounced)
  useEffect(() => {
    if (!url.trim()) {
      setDownloadMeta(null);
      return;
    }

    const isUrl = url.startsWith('http://') || url.startsWith('https://');
    
    // Si es una URL de Spotify, mostrar aviso/bloquear inmediatamente
    if (isUrl && url.includes('spotify.com')) {
      setDownloadMeta({
        title: 'Spotify Desactivado',
        artist: 'Usa enlaces de Tidal o escribe el nombre de la canción.',
        coverArt: null
      });
      return;
    }

    const timer = setTimeout(() => {
      fetch(`${getApiBase()}/api/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setDownloadMeta(data);
        } else {
          setDownloadMeta(null);
        }
      })
      .catch(err => {
        console.error("Error obteniendo preview:", err);
        setDownloadMeta(null);
      });
    }, 600); // 600ms debounce para búsquedas mientras se escribe

    return () => clearTimeout(timer);
  }, [url]);

  // Consultar el progreso de descarga
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (downloading) {
      interval = setInterval(() => {
        fetch(`${getApiBase()}/api/download/progress`)
          .then(res => res.json())
          .then(data => {
            if (data.progress !== undefined) {
              setDownloadProgress(data.progress);
            }
          })
          .catch(() => {});
      }, 500);
    } else {
      setDownloadProgress(0);
    }
    return () => clearInterval(interval);
  }, [downloading]);

  const handleDownload = async () => {
    if (!url) return;
    setDownloading(true);
    setDownloadMsg('Iniciando descarga...');
    setDownloadProgress(0);

    // Obtener metadatos en demanda si no se han cargado por el debounce
    if (!downloadMeta) {
      setDownloadMsg('Obteniendo información...');
      try {
        const metaRes = await fetch(`${getApiBase()}/api/metadata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        if (metaRes.ok) {
          const metadata = await metaRes.json();
          if (!metadata.error) setDownloadMeta(metadata);
        }
      } catch (e) {
        console.error("Error al obtener metadatos:", e);
      }
    }

    setDownloadMsg('Descargando pista en alta calidad de Tidal...');
    try {
      const res = await fetch(`${getApiBase()}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.status === 'duplicate_warning') {
        setDownloadMsg(`⚠️ Duplicado detectado: ${data.message}`);
      } else if (data.error) {
        setDownloadMsg(`❌ Error: ${data.error}`);
      } else {
        setDownloadMsg(`✅ ¡Descarga completada con éxito! Actualizando biblioteca...`);
        // Escanear la carpeta de descargas para que aparezca la nueva canción
        await fetch(`${getApiBase()}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: ["C:\\Users\\Sebas\\Music\\Alta y Media Calidad"] })
        });
        
        onDownloadComplete();
        
        setDownloadMsg(`✅ ¡Descarga lista para escuchar!`);
      }
    } catch (err) {
      setDownloadMsg('❌ Falló la conexión con el servidor.');
    }
    setDownloading(false);
  };

  return (
    <div className="download-panel">
      <h1>Descarga Multimedia (Tidal / Búsqueda)</h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>Escribe el nombre de una canción/artista o pega un enlace de Tidal para descargar en HiFi.</p>
      
      <div className="input-group">
        <input 
          type="text" 
          className="download-input"
          placeholder="Ej: Rick Astley - Never Gonna Give You Up o enlace de Tidal..." 
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
          <DownloadCloud size={20} />
          {downloading ? 'Procesando...' : 'Descargar en Alta Calidad'}
        </button>
        {downloadMsg && <p style={{ marginTop: '12px', fontWeight: 'bold', color: 'var(--color-brand)', whiteSpace: 'pre-wrap' }}>{downloadMsg}</p>}
      </div>

      {downloadMeta && (
        <div className="download-preview" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '24px', backgroundColor: 'var(--color-bg-elevated)', padding: '16px', borderRadius: '8px' }}>
          {downloadMeta.coverArt && (
            <img src={downloadMeta.coverArt} alt="Cover" style={{ width: '80px', height: '80px', borderRadius: '6px', objectFit: 'cover' }} />
          )}
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: 'white', fontSize: '18px', fontWeight: 'bold' }}>{downloadMeta.title}</h3>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '14px' }}>{downloadMeta.artist}</p>
            {downloadMeta.album && <p style={{ margin: '4px 0 0 0', color: 'var(--color-text-secondary)', fontSize: '12px' }}>Álbum: {downloadMeta.album}</p>}
          </div>
        </div>
      )}

      {downloading && (
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, background: 'var(--color-bg-elevated)', borderRadius: '4px', overflow: 'hidden', height: '6px' }}>
            <div style={{ height: '100%', width: `${downloadProgress}%`, background: 'var(--color-brand)', transition: 'width 0.3s ease' }}></div>
          </div>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px', minWidth: '36px' }}>{downloadProgress}%</span>
        </div>
      )}
    </div>
  );
}
