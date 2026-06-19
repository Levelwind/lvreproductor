import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { logError } from '../utils/logger';

const scriptsDir = path.join(__dirname, '..', '..', '..', 'scripts');

export let currentDownloadProgress = 0;

/**
 * Escanea el disco (o library_state.json) para ver si la canción ya existe
 * usando coincidencias parciales del nombre.
 */
export function checkDuplicateLocally(title: string, artist: string): { exists: boolean; path?: string } {
  const statePath = path.join(__dirname, '..', 'library_state.json');
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const lowerTitle = title.toLowerCase();
    const lowerArtist = artist.toLowerCase();
    
    const found = state.tracks.find((t: any) => 
      t.title.toLowerCase().includes(lowerTitle) && 
      t.artist.toLowerCase().includes(lowerArtist)
    );
    
    if (found) {
      return { exists: true, path: found.filePath };
    }
  }
  return { exists: false };
}

// Utilidad para pausar ejecución (Anti-Ban)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Resuelve metadatos de Tidal usando el script Python get_tidal_metadata.py.
 */
export function getTidalMetadata(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(scriptsDir, 'get_tidal_metadata.py');
    exec(`python "${pythonScript}" --url "${url}"`, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      try {
        const data = JSON.parse(stdout.trim());
        if (data.error) {
          return reject(new Error(data.error));
        }
        resolve(data);
      } catch (e) {
        reject(new Error(`Error parseando metadatos de Tidal: ${stdout}`));
      }
    });
  });
}

/**
 * Busca metadatos en APIs públicas (Deezer e iTunes) sin tokens ni límites.
 */
export async function searchPublicMetadata(query: string): Promise<any> {
  // 1. Intentar Deezer primero (rápida, buenas carátulas y gratis)
  try {
    const response = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`);
    if (response.data && response.data.data && response.data.data.length > 0) {
      const track = response.data.data[0];
      return {
        id: String(track.id),
        title: track.title,
        artist: track.artist.name,
        album: track.album.title,
        durationMs: track.duration * 1000,
        isrc: track.isrc || "",
        coverArt: track.album.cover_xl || track.album.cover_big || null,
        url: track.link
      };
    }
  } catch (err: any) {
    console.error('[Metadata Search] Deezer API failed:', err.message);
  }

  // 2. Fallback a iTunes
  try {
    const response = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=1`);
    if (response.data && response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      return {
        id: String(track.trackId),
        title: track.trackName,
        artist: track.artistName,
        album: track.collectionName,
        durationMs: track.trackTimeMillis,
        isrc: "",
        coverArt: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '600x600bb') : null,
        url: track.trackViewUrl
      };
    }
  } catch (err: any) {
    console.error('[Metadata Search] iTunes API failed:', err.message);
  }

  throw new Error(`No se pudo encontrar ninguna canción con la búsqueda: "${query}"`);
}

/**
 * Llama al motor de Python para descargar una canción de Tidal.
 */
export async function downloadTrack(url: string, forceDownload: boolean = false): Promise<any> {
  let metadata: any = { title: "Track Desconocido", artist: "Artista Desconocido", isrc: "" };
  currentDownloadProgress = 0;

  const isUrl = url.startsWith('http://') || url.startsWith('https://');

  if (isUrl) {
    if (url.includes('spotify.com')) {
      throw new Error("La extracción y descarga desde enlaces directos de Spotify está desactivada para evitar baneos de WAF y expiración de tokens. Por favor, escribe el nombre de la canción para buscar y descargar, o usa un enlace de Tidal.");
    } else if (url.includes('tidal.com')) {
      try {
        metadata = await getTidalMetadata(url);
      } catch (err: any) {
        console.warn('[Download] Advertencia resolviendo Tidal metadata:', err.message);
        metadata = {
          title: "Enlace de Tidal Directo",
          artist: "Tidal",
          isrc: "",
          url: url
        };
      }
    } else {
      throw new Error("URL no soportada. Debe ser de Tidal.");
    }
  } else {
    // Si no es URL, es una búsqueda de texto
    metadata = await searchPublicMetadata(url);
  }
  
  // 2. Verificar Duplicados
  if (!forceDownload && metadata.title !== "Enlace de Tidal Directo") {
    const duplicateCheck = checkDuplicateLocally(metadata.title, metadata.artist);
    if (duplicateCheck.exists) {
      return {
        status: 'duplicate_warning',
        message: 'Se detectó una canción similar en tu disco. ¿Deseas descargarla de todas formas?',
        trackInfo: metadata,
        existingPath: duplicateCheck.path
      };
    }
  }

  // ANTI-BAN DE TIDAL: Esperar 4 segundos obligatoriamente
  console.log(`[Anti-Ban] Esperando 4 segundos para prevenir baneos de la API (Track: ${metadata.title})...`);
  await sleep(4000);

  // 3. Proceder con la descarga llamando a Python como subproceso
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(scriptsDir, 'descargar_single.py');
    
    // Si es un enlace de Tidal directo, pasamos la URL directamente
    // Si no, pasamos la información de búsqueda resuelta para que busque y descargue
    const downloadUrl = isUrl ? url : '';
    
    const processArgs = [
      pythonScript, 
      '--url', downloadUrl, 
      '--isrc', metadata.isrc || '',
      '--title', metadata.title || '',
      '--artist', metadata.artist || '',
      '--album', metadata.album || ''
    ];

    const pythonProcess = spawn('python', processArgs);

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      const str = data.toString();
      stdoutData += str;
      
      const match = str.match(/(\d+)%/);
      if (match) {
        currentDownloadProgress = parseInt(match[1], 10);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        logError({
          action: 'descarga_hibrida',
          error_message: 'El script de Python falló o terminó con errores.',
          python_stderr: stderrData,
          context_data: { url: url, isrc: metadata.isrc },
          how_to_fix_suggestion: 'Revisa si los tokens de Tidal expiraron o si yt-dlp necesita actualización.'
        });

        reject(new Error(`Falló la descarga: ${stderrData}`));
      } else {
        const canvasMatch = stdoutData.match(/\[CANVAS\] (.*)/);
        const canvasMsg = canvasMatch ? canvasMatch[1] : '';

        resolve({
          status: 'success',
          message: 'Descarga completada',
          canvasMessage: canvasMsg,
          metadata: metadata,
        });
      }
    });
  });
}
