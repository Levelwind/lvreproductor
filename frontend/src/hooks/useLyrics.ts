import { useState, useEffect } from 'react';

export function useLyrics(artist?: string, title?: string, filePath?: string, refreshVersion: number = 0) {
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const localUrl = `http://localhost:4000/api/lyrics?path=${encodeURIComponent(filePath || '')}&v=${refreshVersion}`;

    const fetchOnline = (fallback: string | null) => {
      if (!artist || !title || artist === '-' || artist === 'Artista Desconocido') {
        if (isMounted) {
          setLyrics(fallback);
          setLoading(false);
        }
        return;
      }

      // Clean up title for better search
      let cleanTitle = title
        .replace(/\(feat\..*?\)/i, '')
        .replace(/ - .*?Remaster/i, '')
        .replace(/\[[a-zA-Z0-9_-]{11}\]/g, '') // Remove YouTube IDs like [GbN0HROyl_w]
        .trim();

      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleanTitle)}`;

      fetch(url)
        .then(res => {
          if (res.status === 404) {
            throw new Error('No se encontraron letras.');
          }
          if (!res.ok) {
            throw new Error('Error de servidor en el servicio de letras.');
          }
          return res.json();
        })
        .then(data => {
          if (isMounted) {
            if (data.syncedLyrics) {
              setLyrics(data.syncedLyrics);
            } else if (data.plainLyrics) {
              setLyrics(data.plainLyrics);
            } else {
              setLyrics(fallback);
              setError(fallback ? null : 'No se encontraron letras.');
            }
          }
        })
        .catch(err => {
          if (isMounted) {
            console.error('Lyrics fetch error:', err.message);
            if (fallback) {
              setLyrics(fallback);
            } else {
              setLyrics(null);
              setError(err.message || 'Error al cargar las letras.');
            }
          }
        })
        .finally(() => {
          if (isMounted) {
            setLoading(false);
          }
        });
    };

    if (filePath) {
      fetch(localUrl)
        .then(res => {
          if (!res.ok) {
            throw new Error('No local lyrics');
          }
          return res.json();
        })
        .then(data => {
          if (isMounted) {
            if (data.syncedLyrics) {
              setLyrics(data.syncedLyrics);
              setLoading(false);
            } else {
              // We have local plain lyrics (or nothing), let's check online for synced lyrics
              const localFallback = data.lyrics || null;
              fetchOnline(localFallback);
            }
          }
        })
        .catch(() => {
          // If local lyrics fail, query online
          fetchOnline(null);
        });
    } else {
      fetchOnline(null);
    }

    return () => {
      isMounted = false;
    };
  }, [artist, title, filePath, refreshVersion]);

  return { lyrics, loading, error };
}
