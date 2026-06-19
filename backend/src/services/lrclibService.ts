import axios from 'axios';
import path from 'path';

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'LevelPlayer/1.0 (https://github.com/level-player)';

interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/**
 * Limpia y extrae metadatos limpios (artista, título) de una canción
 * usando su información de biblioteca y la ruta del archivo.
 */
export function getCleanMetadata(trackName: string, artistName: string, filePath: string): { artist: string; title: string } {
  let artist = artistName;
  let title = trackName;

  // 1. Resolver artista desconocido de la ruta de archivo
  if (!artist || artist === 'Artista Desconocido' || artist === 'Unknown Artist') {
    // Si la ruta contiene subcarpetas de música
    const parts = filePath.split(/[\\/]/);
    if (parts.length >= 2) {
      // Tomamos la carpeta contenedora como artista (ej. .../Artista/Album/Cancion.mp3 o .../Artista/Cancion.mp3)
      // Buscamos si hay un patrón conocido
      const rootIdx = parts.indexOf('Alta y Media Calidad');
      if (rootIdx !== -1 && rootIdx + 1 < parts.length) {
        artist = parts[rootIdx + 1]; // Carpeta de Artista
      } else {
        // Carpeta padre directa o anterior
        const parentDir = parts[parts.length - 2];
        if (parentDir && parentDir !== 'Music' && parentDir !== 'Downloads') {
          artist = parentDir;
        }
      }
    }
  }

  // 2. Extraer artista si está en el título como "Artista - Título"
  const separators = [' - ', ' — ', ' – ', ' ⧸⧸ '];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const potentialArtist = title.substring(0, idx).trim();
      const potentialTitle = title.substring(idx + sep.length).trim();
      
      if (!artist || artist === 'Artista Desconocido' || artist === 'Unknown Artist') {
        artist = potentialArtist;
      }
      title = potentialTitle;
      break;
    }
  }

  // 3. Limpiar artista
  if (artist) {
    artist = artist.replace(/^(Artista Desconocido|Unknown Artist)$/i, '');
    artist = artist.split(/,\s*/)[0]; // Primer artista solamente
    artist = artist.split(/\s*&\s*/)[0]; // Sin "&"
    artist = artist.replace(/\s*\(.*?\)/g, ''); // Quitar paréntesis
    artist = artist.trim();
  }

  // 4. Limpiar título
  if (title) {
    // Quitar extensiones de archivo que se hayan colado en el título (ej: song.flac.fix)
    title = title.replace(/\.(flac|mp3|wav|ogg|m4a|aac|fix)+/gi, '');

    // Quitar número de track al inicio (ej: "05 Rickets" o "04 - Song")
    title = title.replace(/^\d+[\s.-]+/, '');

    // Quitar IDs de YouTube [VA1NdJtbrW0] o (VA1NdJtbrW0)
    title = title.replace(/\s*[\[\(][\w-]{11}[\]\)]\s*/g, '');

    // Quitar etiquetas comunes
    title = title.replace(/\((?:remastered\s*\d*|official\s*(?:video|audio|lyric\s*video)|music\s*video|audio|lyrics?|with\s*lyrics?|animated\s*music\s*video|explicit|clean)\)/gi, '');
    title = title.replace(/\[(?:remastered\s*\d*|official\s*(?:video|audio|lyric\s*video)|music\s*video|audio|lyrics?|with\s*lyrics?|animated\s*music\s*video|explicit|clean)\]/gi, '');

    // Quitar colaboraciones para la búsqueda en LRCLIB
    title = title.replace(/\s*[\[\(]feat\.?\s*[^\]\)]*[\]\)]/gi, '');
    title = title.replace(/\s*[\[\(]with\s+[^\]\)]*[\]\)]/gi, '');

    // Limpieza de guiones redundantes y espacios extras
    title = title.replace(/\s{2,}/g, ' ').trim();
  }

  return {
    artist: artist || '',
    title: title || ''
  };
}

/**
 * Busca letras sincronizadas en LRCLIB por nombre de canción, artista y ruta de archivo.
 * Retorna la mejor coincidencia.
 */
export async function searchLrclib(trackName: string, artistName: string, filePath: string): Promise<LrclibResult | null> {
  try {
    const { artist, title } = getCleanMetadata(trackName, artistName, filePath);
    
    if (!title) {
      return null;
    }

    console.log(`[LRCLIB] Buscando: "${artist}" - "${title}"`);

    // Búsqueda principal
    const params: Record<string, string> = {};
    if (artist) {
      params.artist_name = artist;
      params.track_name = title;
    } else {
      params.q = title;
    }

    const response = await axios.get<LrclibResult[]>(`${LRCLIB_BASE}/search`, {
      params,
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    });

    const results = response.data;
    if (!results || results.length === 0) {
      // Fallback 1: buscar con q genérico juntando artista y título
      if (artist) {
        const fallbackRes = await axios.get<LrclibResult[]>(`${LRCLIB_BASE}/search`, {
          params: { q: `${artist} ${title}` },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 10000
        });
        if (fallbackRes.data && fallbackRes.data.length > 0) {
          const synced = fallbackRes.data.find(r => r.syncedLyrics);
          return synced || fallbackRes.data[0];
        }
      }

      // Fallback 2: Corrección por búsqueda difusa en Deezer
      try {
        const query = artist ? `${artist} ${title}` : title;
        console.log(`[DEEZER-FUZZY] Buscando corrección para: "${query}"`);
        const deezerRes = await axios.get(`https://api.deezer.com/search`, {
          params: { q: query },
          timeout: 5000
        });
        const match = deezerRes.data?.data?.[0];
        if (match) {
          const correctedArtist = match.artist?.name;
          const correctedTitle = match.title;
          
          if (correctedArtist && correctedTitle && 
              (correctedArtist.toLowerCase() !== artist.toLowerCase() || correctedTitle.toLowerCase() !== title.toLowerCase())) {
            console.log(`[DEEZER-FUZZY] Encontrada corrección: "${correctedArtist}" - "${correctedTitle}". Reintentando en LRCLIB.`);
            
            const retryRes = await axios.get<LrclibResult[]>(`${LRCLIB_BASE}/search`, {
              params: { artist_name: correctedArtist, track_name: correctedTitle },
              headers: { 'User-Agent': USER_AGENT },
              timeout: 10000
            });
            
            if (retryRes.data && retryRes.data.length > 0) {
              const synced = retryRes.data.find(r => r.syncedLyrics);
              return synced || retryRes.data[0];
            }
          }
        }
      } catch (deezerErr: any) {
        console.warn(`[DEEZER-FUZZY] Error al buscar corrección:`, deezerErr.message);
      }

      return null;
    }

    // Priorizar resultados con letras sincronizadas
    const synced = results.find(r => r.syncedLyrics);
    return synced || results[0];
  } catch (err: any) {
    console.error(`[LRCLIB] Error buscando "${trackName}" - "${artistName}":`, err.message);
    return null;
  }
}

/**
 * Formatea el resultado de LRCLIB para uso interno.
 */
export function formatLrclibResult(result: LrclibResult): { synced: boolean; syncedLyrics: string | null; plainLyrics: string } {
  if (result.syncedLyrics) {
    // Las letras sincronizadas de LRCLIB ya vienen en formato LRC estándar
    return {
      synced: true,
      syncedLyrics: result.syncedLyrics,
      plainLyrics: result.plainLyrics || result.syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim()
    };
  }

  return {
    synced: false,
    syncedLyrics: null,
    plainLyrics: result.plainLyrics || ''
  };
}
