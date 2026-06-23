import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
// [DESACTIVADO] Spotify service — se conserva el archivo pero no se usa activamente.
// import { getSpotifyMetadata, searchSpotifyCover, fetchSpotifyLyrics } from './services/spotifyService';
import { downloadTrack, currentDownloadProgress, getTidalMetadata, searchPublicMetadata } from './services/downloadService';
import { searchLrclib, formatLrclibResult, getCleanMetadata } from './services/lrclibService';
import playerService from './services/playerService';
import type { Track } from './types/player';
import { scanAndSyncLibrary, getLibrary, migrateCanvasPaths, updateTrackLyrics, getTrackLyrics, createPlaylist, deletePlaylist, updatePlaylist, queryLibrary, getTrackById } from './services/libraryService';
import lyricsSyncService from './services/lyricsSyncService';
import { getCover } from './services/coverService';
import fs from 'fs';
import { getConfigPath } from './utils/config';


const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ruta de prueba para verificar que el servidor funciona
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Level Player Backend is running!' });
});

// =============================================
// CONTROL DEL REPRODUCTOR NATIVO (mpv + SSE)
// =============================================

app.get('/api/player/events', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  playerService.registerSseClient(res);
});

app.get('/api/player/state', (_req: Request, res: Response) => {
  res.json(playerService.getState());
});

app.post('/api/player/play', (req: Request, res: Response) => {
  try {
    const { track, trackId, queue, queueTrackIds, playlistId, startPos } = (req.body as {
      track?: Track;
      trackId?: string;
      queue?: Track[];
      queueTrackIds?: string[];
      playlistId?: string | null;
      startPos?: number;
    }) || {};

    let targetTrack: Track | undefined = track;
    if (!targetTrack && trackId) {
      targetTrack = getTrackById(trackId) as any;
    }

    let targetQueue: Track[] | undefined = queue;
    if (!targetQueue) {
      if (Array.isArray(queueTrackIds)) {
        targetQueue = queueTrackIds
          .map(id => getTrackById(id))
          .filter((t): t is any => !!t) as Track[];
      } else if (playlistId) {
        const lib = getLibrary();
        const playlist = lib.playlists?.find(p => p.id === playlistId);
        if (playlist) {
          targetQueue = playlist.trackIds
            .map(id => getTrackById(id))
            .filter((t): t is any => !!t) as Track[];
        }
      } else if (targetTrack) {
        targetQueue = getLibrary().tracks as any[];
      }
    }

    if (targetTrack) {
      playerService.playTrack(
        targetTrack,
        Array.isArray(targetQueue) ? targetQueue : undefined,
        typeof startPos === 'number' ? startPos : 0
      );
    } else {
      playerService.togglePlay();
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error in /api/player/play:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

app.post('/api/player/pause', (_req: Request, res: Response) => {
  playerService.togglePlay();
  res.json({ success: true });
});

app.post('/api/player/next', async (_req: Request, res: Response) => {
  await playerService.skipNext(true);
  res.json({ success: true });
});

app.post('/api/player/prev', (_req: Request, res: Response) => {
  playerService.skipPrevious(true);
  res.json({ success: true });
});

app.post('/api/player/volume', (req: Request, res: Response) => {
  const { volume } = req.body as { volume?: number };
  if (typeof volume === 'number') {
    playerService.setVolume(volume);
  }
  res.json({ success: true });
});

app.post('/api/player/seek', (req: Request, res: Response) => {
  const { seconds } = req.body as { seconds?: number };
  if (typeof seconds === 'number') {
    playerService.seekTo(seconds);
  }
  res.json({ success: true });
});

app.post('/api/player/shuffle', (_req: Request, res: Response) => {
  playerService.toggleShuffle();
  res.json({ success: true });
});

app.post('/api/player/loop', (_req: Request, res: Response) => {
  playerService.toggleLoop();
  res.json({ success: true });
});

app.post('/api/player/queue/add', (req: Request, res: Response) => {
  const { trackId } = req.body as { trackId?: string };
  if (trackId) {
    const track = getTrackById(trackId);
    if (track) {
      playerService.addToPlayQueue(track);
    }
  }
  res.json({ success: true });
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

// Endpoint para obtener la biblioteca local paginada, con filtros y búsqueda flexible
app.get('/api/library', (req: Request, res: Response) => {
  try {
    const { q, limit, offset, playlistId } = req.query;

    const result = queryLibrary({
      q: typeof q === 'string' ? q : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      playlistId: typeof playlistId === 'string' ? playlistId : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error en /api/library:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// Endpoints para gestionar playlists
app.post('/api/playlists', (req: Request, res: Response) => {
  try {
    const { name, trackIds = [] } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Falta el nombre de la playlist' });
    }
    const playlist = createPlaylist(name, trackIds);
    res.status(201).json(playlist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string') {
      return res.status(400).json({ error: 'ID de playlist inválido' });
    }
    const success = deletePlaylist(id);
    if (!success) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }
    res.json({ success: true, message: 'Playlist eliminada exitosamente' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/playlists/:id', (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (typeof id !== 'string') {
      return res.status(400).json({ error: 'ID de playlist inválido' });
    }
    const { name, trackIds } = req.body;
    const playlist = updatePlaylist(id, name, trackIds);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }
    res.json(playlist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener letras en demanda
app.get('/api/lyrics', (req: Request, res: Response) => {
  const audioPath = req.query.path as string;
  if (!audioPath) {
    return res.status(400).json({ error: 'Falta el parámetro path' });
  }
  const lib = getLibrary();
  const track = lib.tracks.find(t => t.filePath === audioPath);
  if (track) {
    const lyricsData = getTrackLyrics(track.id);
    if (lyricsData.lyrics || lyricsData.syncedLyrics) {
      return res.json(lyricsData);
    }
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
// SINCRONIZACIÓN MASIVA DE LETRAS (Manejada por lyricsSyncService)
// =============================================

// Endpoint para iniciar la sincronización masiva
app.post('/api/lyrics/sync-all', async (req: Request, res: Response) => {
  try {
    const { mode = 'missing' } = req.body;
    const lib = getLibrary();
    lyricsSyncService.startSync(lib.tracks, mode);
    res.json({ success: true, message: `Iniciando sincronización de letras en modo "${mode}"` });
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

// Endpoint para verificar el progreso de la sincronización
app.get('/api/lyrics/sync-status', (req: Request, res: Response) => {
  res.json(lyricsSyncService.getProgress());
});

// Endpoint para detener la sincronización
app.post('/api/lyrics/sync-stop', (req: Request, res: Response) => {
  const success = lyricsSyncService.stopSync();
  if (!success) {
    return res.status(400).json({ error: 'No hay sincronización en curso o ya está detenida' });
  }
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

  res.setHeader('Cache-Control', 'public, max-age=86400');

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

    res.on('close', () => {
      file.destroy();
    });

    file.pipe(res);
  } else {
    const file = fs.createReadStream(audioPath);
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);

    res.on('close', () => {
      file.destroy();
    });

    file.pipe(res);
  }
});

// Endpoint para extraer la carátula al vuelo o buscarla en iTunes/Deezer si no existe localmente
app.get('/api/cover', async (req: Request, res: Response) => {
  const audioPath = req.query.path as string;
  const forceSearch = req.query.force_search === 'true';

  if (!audioPath) {
    return res.status(400).send('Falta el parámetro path');
  }

  try {
    const result = await getCover(audioPath, forceSearch);
    if (!result) {
      return res.status(404).send('Carátula no encontrada');
    }

    if ('redirectUrl' in result) {
      return res.redirect(result.redirectUrl);
    }

    res.set('Content-Type', result.contentType);
    res.set('Content-Length', result.data.length.toString());
    return res.send(result.data);
  } catch (error) {
    console.error('Error al procesar carátula en endpoint:', error);
    res.status(500).send('Error al procesar la carátula');
  }
});

// --- SISTEMA DE CONFIGURACIÓN Y TOKENS ---

const configPath = getConfigPath();

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
    // Leer config anterior para detectar cambios que requieran reinicio
    let oldConfig: any = {};
    try {
      oldConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* ignore */ }
    const oldExclusive = oldConfig?.audio?.exclusiveMode;
    const newExclusive = newConfig?.audio?.exclusiveMode;

    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

    // Si cambió el modo exclusivo, reiniciar MPD para que再生 la nueva config de audio
    if (oldExclusive !== undefined && oldExclusive !== newExclusive) {
      playerService.restartMpd();
    } else {
      // Solo re-aplicar settings que no requieren reinicio
      playerService.reapplyAudioConfig();
    }
    res.json({ status: 'success', message: 'Configuración actualizada' });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

// Endpoint para abrir diálogo nativo de Windows (Folder Browser Dialog) vía PowerShell
app.get('/api/folders/select', (req: Request, res: Response) => {
  try {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      $f = New-Object System.Windows.Forms.FolderBrowserDialog;
      $f.ShowNewFolderButton = $true;
      $f.Description = 'Selecciona tu carpeta de musica';
      $result = $f.ShowDialog();
      if ($result -eq 'OK') {
        $f.SelectedPath
      }
    `.replace(/\r?\n/g, ' ').trim();

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`;

    exec(cmd, (err, stdout) => {
      if (err) {
        console.error('[Dialog] Error al abrir dialogo de carpeta:', err);
        return res.json({ path: null });
      }
      const selectedPath = stdout.trim();
      res.json({ path: selectedPath || null });
    });
  } catch (error: any) {
    console.error('[Dialog] Error en endpoint /api/folders/select:', error);
    res.json({ path: null });
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
