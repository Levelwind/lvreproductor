import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
// [DESACTIVADO] Spotify service — se conserva el archivo pero no se usa activamente.
// import { getSpotifyMetadata, searchSpotifyCover, fetchSpotifyLyrics } from './services/spotifyService';
import { downloadTrack, currentDownloadProgress, getTidalMetadata, searchPublicMetadata } from './services/downloadService';
import { searchLrclib, formatLrclibResult, getCleanMetadata } from './services/lrclibService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Ruta de prueba para verificar que el servidor funciona
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Level Player Backend is running!' });
});

// Endpoint para consultar metadatos por URL (Tidal) o por búsqueda de texto (iTunes/Deezer)
app.post('/api/metadata', async (req: Request, res: Response) => {
  try {
    const { url, query } = req.body;
    
    // Si no hay url pero hay query, buscar por texto
    if (!url && query) {
      const metadata = await searchPublicMetadata(query);
      return res.json(metadata);
    }
    
    if (!url) {
      return res.status(400).json({ error: 'Debes proporcionar una URL o una consulta de búsqueda' });
    }

    const isUrl = url.startsWith('http://') || url.startsWith('https://');
    
    if (isUrl) {
      if (url.includes('spotify.com')) {
        return res.status(400).json({ error: 'La extracción de Spotify está desactivada. Por favor, busca por texto o usa un enlace de Tidal.' });
      } else if (url.includes('tidal.com')) {
        const metadata = await getTidalMetadata(url);
        return res.json(metadata);
      } else {
        return res.status(400).json({ error: 'URL no soportada. Solo se admiten enlaces de Tidal.' });
      }
    } else {
      // Si el cliente envió texto en el campo 'url'
      const metadata = await searchPublicMetadata(url);
      return res.json(metadata);
    }
  } catch (error: any) {
    console.error('Error fetching metadata:', error.message);
    res.status(500).json({ error: error.message || 'Error interno al obtener metadatos' });
  }
});

// Endpoint para descargar música
app.post('/api/download', async (req: Request, res: Response) => {
  try {
    const { url, forceDownload } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Debes proporcionar una URL o búsqueda de texto' });
    }

    const result = await downloadTrack(url, forceDownload);
    res.json(result);
  } catch (error: any) {
    console.error('Error in download:', error.message);
    res.status(500).json({ error: 'Falló el proceso de descarga', details: error.message });
  }
});

// Endpoint para progreso de descarga
app.get('/api/download/progress', (req: Request, res: Response) => {
  res.json({ progress: currentDownloadProgress });
});

import { scanAndSyncLibrary, getLibrary, migrateCanvasPaths, updateTrackLyrics } from './services/libraryService';
import fs from 'fs';

// ... existing endpoints

// Endpoint para obtener toda la biblioteca local (optimizada sin letras)
app.get('/api/library', (req: Request, res: Response) => {
  const lib = getLibrary();
  const lightTracks = lib.tracks.map(({ lyrics, syncedLyrics, ...rest }) => rest);
  res.json({ playlists: lib.playlists, tracks: lightTracks });
});

// Endpoint para obtener letras en demanda
app.get('/api/lyrics', (req: Request, res: Response) => {
  const audioPath = req.query.path as string;
  if (!audioPath) {
    return res.status(400).json({ error: 'Falta el parámetro path' });
  }
  const lib = getLibrary();
  const track = lib.tracks.find(t => t.filePath === audioPath);
  if (track && (track.lyrics || track.syncedLyrics)) {
    return res.json({
      lyrics: track.lyrics || null,
      syncedLyrics: track.syncedLyrics || null
    });
  }
  return res.status(404).json({ error: 'Letras no encontradas para este archivo' });
});

// [DESACTIVADO] Endpoint de sincronización de letras vía Spotify.
// Se conserva como stub para no romper posibles llamadas externas.
app.post('/api/lyrics/spotify/sync', (_req: Request, res: Response) => {
  return res.status(410).json({ 
    error: 'La sincronización de letras vía Spotify está desactivada. Usa LRCLIB a través de /api/lyrics/sync-all.' 
  });
});

// =============================================
// SINCRONIZACIÓN MASIVA DE LETRAS (LRCLIB + Deezer Fuzzy)
// =============================================

interface SyncProgress {
  running: boolean;
  total: number;
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  currentTrack: string;
  results: Array<{ title: string; artist: string; status: 'synced' | 'plain' | 'failed' | 'skipped'; source: string }>;
}

let syncProgress: SyncProgress = {
  running: false,
  total: 0,
  processed: 0,
  synced: 0,
  failed: 0,
  skipped: 0,
  currentTrack: '',
  results: []
};

let syncAbortFlag = false;

// Endpoint para iniciar la sincronización masiva
app.post('/api/lyrics/sync-all', async (req: Request, res: Response) => {
  if (syncProgress.running) {
    return res.status(409).json({ error: 'Ya hay una sincronización en curso', progress: syncProgress });
  }

  const { mode = 'missing' } = req.body;
  // mode: 'missing' = solo canciones sin letras, 'unsynced' = sin letras sincronizadas, 'all' = todas

  const lib = getLibrary();
  let tracksToSync = lib.tracks;

  if (mode === 'missing') {
    tracksToSync = tracksToSync.filter(t => !t.syncedLyrics && !t.lyrics);
  } else if (mode === 'unsynced') {
    tracksToSync = tracksToSync.filter(t => !t.syncedLyrics || !/\[\d{2}:\d{2}/.test(t.syncedLyrics || ''));
  }
  // mode === 'all' -> sincronizar todas

  syncProgress = {
    running: true,
    total: tracksToSync.length,
    processed: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    currentTrack: '',
    results: []
  };
  syncAbortFlag = false;

  res.json({ success: true, total: tracksToSync.length, message: `Iniciando sincronización de ${tracksToSync.length} canciones` });

  // Procesar en background (no bloquear la respuesta HTTP)
  (async () => {
    for (const track of tracksToSync) {
      if (syncAbortFlag) {
        console.log('[SYNC-ALL] Sincronización detenida por el usuario.');
        break;
      }

      const { artist: cleanArtist, title: cleanTitle } = getCleanMetadata(track.title, track.artist, track.filePath);
      syncProgress.currentTrack = `${cleanArtist} - ${cleanTitle}`;

      try {
        // 1. Intentar LRCLIB primero (gratis, sin auth, sin rate limit)
        const lrclibResult = await searchLrclib(cleanTitle, cleanArtist, track.filePath);

        if (lrclibResult && (lrclibResult.syncedLyrics || lrclibResult.plainLyrics)) {
          const formatted = formatLrclibResult(lrclibResult);
          updateTrackLyrics(track.id, formatted.plainLyrics, formatted.syncedLyrics);

          syncProgress.synced++;
          syncProgress.results.push({
            title: cleanTitle,
            artist: cleanArtist,
            status: formatted.synced ? 'synced' : 'plain',
            source: 'LRCLIB'
          });
          console.log(`[SYNC] ✓ ${cleanArtist} - ${cleanTitle} (LRCLIB, ${formatted.synced ? 'synced' : 'plain'})`);
        } else {
          // Si no está en LRCLIB ni Deezer Fuzzy, registramos como fallida
          syncProgress.failed++;
          syncProgress.results.push({
            title: track.title,
            artist: track.artist,
            status: 'failed',
            source: 'none'
          });
          console.log(`[SYNC] ✗ ${track.artist} - ${track.title} (no encontrada en LRCLIB)`);
        }
      } catch (err: any) {
        syncProgress.failed++;
        syncProgress.results.push({
          title: track.title,
          artist: track.artist,
          status: 'failed',
          source: 'error'
        });
        console.error(`[SYNC] Error en ${track.title}:`, err.message);
      }

      syncProgress.processed++;

      // Pequeña pausa para no abusar de las APIs (200ms entre peticiones)
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    syncProgress.running = false;
    syncProgress.currentTrack = '';
    console.log(`[SYNC-ALL] Completado: ${syncProgress.synced} sincronizadas, ${syncProgress.failed} fallidas de ${syncProgress.total} total`);
  })();
});

// Endpoint para verificar el progreso de la sincronización
app.get('/api/lyrics/sync-status', (req: Request, res: Response) => {
  res.json(syncProgress);
});

// Endpoint para detener la sincronización
app.post('/api/lyrics/sync-stop', (req: Request, res: Response) => {
  if (!syncProgress.running) {
    return res.status(400).json({ error: 'No hay sincronización en curso' });
  }
  syncAbortFlag = true;
  res.json({ success: true, message: 'Deteniendo sincronización...' });
});

// Endpoint para escanear carpetas
app.post('/api/scan', async (req: Request, res: Response) => {
  try {
    const { folders } = req.body;
    if (!folders || !Array.isArray(folders)) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de carpetas "folders"' });
    }
    const result = await scanAndSyncLibrary(folders);
    res.json({ status: 'success', tracksCount: result.tracks.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al escanear', details: error.message });
  }
});

// Endpoint para streamear audio local al frontend
app.get('/api/stream', (req: Request, res: Response) => {
  const audioPath = req.query.path as string;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).send('Archivo no encontrado');
  }

  const stat = fs.statSync(audioPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const getContentType = (filePath: string) => {
    if (filePath.endsWith('.flac')) return 'audio/flac';
    if (filePath.endsWith('.mp3')) return 'audio/mpeg';
    if (filePath.endsWith('.mp4')) return 'video/mp4';
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
  };

  const contentType = getContentType(audioPath);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(audioPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(audioPath).pipe(res);
  }
});

import * as mm from 'music-metadata';

async function searchItunesCover(query: string): Promise<string | null> {
  try {
    const response = await axios.get(`https://itunes.apple.com/search`, {
      params: {
        term: query,
        media: 'music',
        limit: 1
      }
    });
    const results = response.data.results;
    if (results && results.length > 0) {
      const url = results[0].artworkUrl100;
      if (url) {
        return url.replace('100x100bb', '600x600bb');
      }
    }
  } catch (err) {
    console.error('Error buscando carátula en iTunes:', err);
  }
  return null;
}

async function searchDeezerCover(query: string): Promise<string | null> {
  try {
    const response = await axios.get(`https://api.deezer.com/search`, {
      params: { q: query, limit: 1 }
    });
    const tracks = response.data.data;
    if (tracks && tracks.length > 0) {
      return tracks[0].album.cover_xl || tracks[0].album.cover_big || null;
    }
  } catch (err: any) {
    console.error('Error buscando carátula en Deezer:', err.message);
  }
  return null;
}

// Endpoint para extraer la carátula al vuelo o buscarla en iTunes/Deezer si no existe localmente
app.get('/api/cover', async (req: Request, res: Response) => {
  const audioPath = req.query.path as string;
  const forceSearch = req.query.force_search === 'true';
  
  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).send('Archivo no encontrado');
  }

  const dir = path.dirname(audioPath);

  // Si se solicita búsqueda forzada, saltamos la caché local y buscamos online
  if (forceSearch) {
    return handleOnlineCoverSearch(audioPath, res);
  }

  try {
    // 1. Intentar primero con un cover local (jpg, png, webp)
    const coverFormats = [
      { file: 'cover.jpg', mime: 'image/jpeg' },
      { file: 'cover.png', mime: 'image/png' },
      { file: 'cover.webp', mime: 'image/webp' },
    ];
    for (const fmt of coverFormats) {
      const coverPath = path.join(dir, fmt.file);
      if (fs.existsSync(coverPath)) {
        const imgData = fs.readFileSync(coverPath);
        res.set('Content-Type', fmt.mime);
        res.set('Content-Length', imgData.length.toString());
        return res.send(imgData);
      }
    }

    const metadata = await mm.parseFile(audioPath);
    const hasEmbedded = metadata.common.picture && metadata.common.picture.length > 0;
    
    // 2. Si hay carátula incrustada y es de buena calidad (> 30 KB), la usamos directamente
    if (hasEmbedded) {
      const picture = metadata.common.picture![0];
      if (picture.data.length > 30720) {
        res.set('Content-Type', picture.format);
        res.set('Content-Length', picture.data.length.toString());
        return res.send(picture.data);
      }
    }

    // 3. Si no hay cover.jpg local y la incrustada es muy pequeña (< 30 KB) o no existe,
    // intentamos buscar una carátula de alta resolución en línea y guardarla.
    return handleOnlineCoverSearch(audioPath, res, hasEmbedded ? metadata.common.picture![0] : undefined);

  } catch (error) {
    console.error('Error extrayendo o buscando carátula:', error);
    res.status(500).send('Error al procesar la carátula');
  }
});

// Función auxiliar para buscar y guardar carátula online de alta calidad
async function handleOnlineCoverSearch(audioPath: string, res: Response, fallbackPicture?: mm.IPicture) {
  try {
    let metadata;
    try {
      metadata = await mm.parseFile(audioPath);
    } catch (e) {
      metadata = { common: { title: path.basename(audioPath), artist: undefined } };
    }

    let title = metadata.common.title || path.basename(audioPath);
    const artist = metadata.common.artist;
    
    // Limpieza agresiva del título
    title = title.replace(/\.(mp3|flac|wav)$/i, ''); 
    title = title.replace(/\[.*?\]/g, ''); 
    title = title.replace(/\(official video\)|\(with lyrics\)|\(lyrics\)|\(audio\)|\(music video\)/ig, ''); 
    title = title.replace(/-+/g, ' '); 
    
    let query = title.trim();
    if (artist && artist !== 'Artista Desconocido') {
      query += ` ${artist}`;
    }

    if (query) {
      let imageUrl: string | null = null;
      
      // Buscar en iTunes primero
      imageUrl = await searchItunesCover(query);
      
      // Fallback a Deezer si iTunes no encuentra nada
      if (!imageUrl) {
        imageUrl = await searchDeezerCover(query);
      }
      
      if (imageUrl) {
        try {
          const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          const imgBuffer = Buffer.from(imgResponse.data);
          
          const dir = path.dirname(audioPath);
          const localCover = path.join(dir, 'cover.jpg');
          fs.writeFileSync(localCover, imgBuffer);
          
          res.set('Content-Type', 'image/jpeg');
          res.set('Content-Length', imgBuffer.length.toString());
          return res.send(imgBuffer);
        } catch (dlError) {
          console.error('Error al descargar y guardar la carátula en disco:', dlError);
          return res.redirect(imageUrl);
        }
      }
    }
  } catch (searchErr) {
    console.error('Error en búsqueda online de carátula:', searchErr);
  }

  // Si falló la búsqueda online pero teníamos una carátula incrustada (aunque sea pequeña), la usamos de fallback
  if (fallbackPicture) {
    res.set('Content-Type', fallbackPicture.format);
    res.set('Content-Length', fallbackPicture.data.length.toString());
    return res.send(fallbackPicture.data);
  }

  return res.status(404).send('Carátula no encontrada');
}

// --- SISTEMA DE CONFIGURACIÓN Y TOKENS ---

const configPath = path.join(__dirname, 'config.json');

app.get('/api/config', (req: Request, res: Response) => {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
});

app.post('/api/config', (req: Request, res: Response) => {
  try {
    const newConfig = req.body;
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    res.json({ status: 'success', message: 'Configuración actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Level Player Backend corriendo en http://localhost:${PORT}`);
  
  try {
    migrateCanvasPaths();
  } catch (err) {
    console.error("Error al correr migración de canvas:", err);
  }
});
