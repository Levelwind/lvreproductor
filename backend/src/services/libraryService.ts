import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const statePath = path.join(__dirname, '..', 'library_state.json');
const lyricsDir = path.join(__dirname, '..', 'lyrics');

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  filePath: string;
  coverArt?: string;
  urlPath: string;
  canvasPath?: string;
  lyrics?: string;
  syncedLyrics?: string;
  mtimeMs?: number;
  fileSize?: number;
  isUnavailable?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
  isFavorite?: boolean;
}

export interface LibraryState {
  version: number;
  playlists: Playlist[];
  tracks: Track[];
}

// Caché en memoria para evitar lecturas de disco repetitivas en cada consulta
let cachedState: LibraryState | null = null;

const CURRENT_VERSION = 2;

function migrateStateSchema(state: any): LibraryState {
  let modified = false;
  
  if (!state) {
    return { version: CURRENT_VERSION, playlists: [], tracks: [] };
  }

  // Si no tiene versión, asumimos versión 1
  let version = typeof state.version === 'number' ? state.version : 1;

  if (version < 2) {
    console.log(`[MIGRATION] Migrando library_state.json de versión ${version} a versión 2.`);
    if (state.tracks && Array.isArray(state.tracks)) {
      for (const track of state.tracks) {
        if (track.isUnavailable === undefined) {
          track.isUnavailable = false;
        }
        if (track.filePath && fs.existsSync(track.filePath)) {
          try {
            const stat = fs.statSync(track.filePath);
            if (track.mtimeMs === undefined) track.mtimeMs = stat.mtime.getTime();
            if (track.fileSize === undefined) track.fileSize = stat.size;
          } catch (e) {
            console.error(`Error leyendo estadísticas para migración de track ${track.id}:`, e);
          }
        }
      }
    }
    state.version = CURRENT_VERSION;
    modified = true;
  }

  // Asegurar que las colecciones básicas existen
  if (!state.playlists) {
    state.playlists = [];
    modified = true;
  }
  if (!state.tracks) {
    state.tracks = [];
    modified = true;
  }

  if (modified) {
    // Guardar el estado directamente sin usar cachedState todavía
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  return state as LibraryState;
}

function getLibraryState(): LibraryState {
  if (cachedState) {
    return cachedState;
  }
  if (fs.existsSync(statePath)) {
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      const parsed = JSON.parse(raw);
      cachedState = migrateStateSchema(parsed);
      return cachedState;
    } catch (err) {
      console.error('[Library] Error leyendo library_state.json:', err);
    }
  }
  cachedState = { version: CURRENT_VERSION, playlists: [], tracks: [] };
  return cachedState;
}

function saveLibraryState(state: LibraryState) {
  state.version = CURRENT_VERSION;
  cachedState = state;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function getLyricsPath(trackId: string): string {
  const hash = crypto.createHash('sha256').update(trackId).digest('hex');
  return path.join(lyricsDir, `${hash}.json`);
}

// Obtener letras del archivo individual
export function getTrackLyrics(trackId: string): { lyrics: string | null; syncedLyrics: string | null } {
  const lyricsPath = getLyricsPath(trackId);
  if (fs.existsSync(lyricsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));
      return {
        lyrics: data.lyrics || null,
        syncedLyrics: data.syncedLyrics || null
      };
    } catch (err) {
      console.error(`Error leyendo letras para track ${trackId}:`, err);
    }
  }
  return { lyrics: null, syncedLyrics: null };
}

// Migración de letras del JSON principal a archivos individuales
export function migrateLyricsToFiles() {
  if (!fs.existsSync(lyricsDir)) {
    fs.mkdirSync(lyricsDir, { recursive: true });
  }

  if (!fs.existsSync(statePath)) return;

  try {
    const state = getLibraryState();
    let modified = false;

    for (const track of state.tracks) {
      if (track.lyrics || track.syncedLyrics) {
        const lyricsPath = getLyricsPath(track.id);
        if (!fs.existsSync(lyricsPath)) {
          const lyricsContent = {
            lyrics: track.lyrics || null,
            syncedLyrics: track.syncedLyrics || null
          };
          fs.writeFileSync(lyricsPath, JSON.stringify(lyricsContent, null, 2), 'utf-8');
        }
        delete track.lyrics;
        delete track.syncedLyrics;
        modified = true;
      }
    }

    if (modified) {
      saveLibraryState(state);
      console.log(`[MIGRATION] Sincronizado library_state.json ligero (sin letras).`);
    }
  } catch (err) {
    console.error('[MIGRATION] Error migrando letras a archivos independientes:', err);
  }
}

import * as mm from 'music-metadata';

const AUDIO_EXTENSIONS = new Set(['.flac', '.mp3', '.m4a', '.mp4', '.opus', '.ogg', '.wav', '.aac', '.webm', '.wma']);

/**
 * Escanea recursivamente un directorio buscando archivos de audio soportados.
 */
function scanDirectoryRecursively(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDirectoryRecursively(fullPath, fileList);
        } else {
          const ext = path.extname(file).toLowerCase();
          const isCanvas = file.toLowerCase().includes('.canvas.');
          if (AUDIO_EXTENSIONS.has(ext) && !isCanvas) {
            fileList.push(fullPath);
          }
        }
      } catch (err) {
        console.error(`Error leyendo estado de archivo ${fullPath}:`, err);
      }
    }
  } catch (err) {
    console.error(`Error leyendo directorio ${dir}:`, err);
  }
  return fileList;
}

/**
 * Escanea y actualiza la biblioteca local asíncronamente.
 */
export async function scanAndSyncLibrary(folderPaths: string[]): Promise<LibraryState> {
  const state = getLibraryState();

  // 1. Primero, actualizar flag isUnavailable para todos los tracks existentes en base a su presencia física actual
  state.tracks.forEach(track => {
    if (!fs.existsSync(track.filePath)) {
      track.isUnavailable = true;
    } else {
      track.isUnavailable = false;
    }
  });

  // 2. Escaneo físico
  for (const folder of folderPaths) {
    const audioFiles = scanDirectoryRecursively(folder);
    
    for (const filePath of audioFiles) {
      try {
        const stat = fs.statSync(filePath);
        const existingIndex = state.tracks.findIndex(t => t.filePath === filePath);
        
        if (existingIndex !== -1) {
          const existing = state.tracks[existingIndex];
          // Si mtime y fileSize coinciden y no está marcado como no disponible, asumimos que no ha cambiado
          if (
            existing.mtimeMs === stat.mtime.getTime() &&
            existing.fileSize === stat.size &&
            !existing.isUnavailable
          ) {
            continue;
          }
          
          // Si cambió o estaba marcado como no disponible pero ahora existe, re-analizar la metadata
          const fileName = path.basename(filePath);
          let title = fileName.replace(/\.(mp3|flac|m4a|mp4|opus|ogg|wav|aac|webm|wma)$/i, '');
          let artist = 'Artista Desconocido';
          let album = 'Álbum Local';
          let duration = existing.duration;

          try {
            const metadata = await mm.parseFile(filePath);
            if (metadata.common.title) title = metadata.common.title;
            if (metadata.common.artist) artist = metadata.common.artist;
            if (metadata.common.album) album = metadata.common.album;
            if (metadata.format.duration) duration = metadata.format.duration;
          } catch (err) {
            console.error(`Error leyendo metadata de archivo modificado ${filePath}:`, err);
          }

          state.tracks[existingIndex] = {
            ...existing,
            title,
            artist,
            album,
            duration,
            mtimeMs: stat.mtime.getTime(),
            fileSize: stat.size,
            isUnavailable: false,
            canvasPath: checkCanvasPath(filePath)
          };
        } else {
          // Track nuevo
          const fileName = path.basename(filePath);
          let title = fileName.replace(/\.(mp3|flac|m4a|mp4|opus|ogg|wav|aac|webm|wma)$/i, '');
          let artist = 'Artista Desconocido';
          let album = 'Álbum Local';
          let duration: number | undefined;

          try {
            const metadata = await mm.parseFile(filePath);
            if (metadata.common.title) title = metadata.common.title;
            if (metadata.common.artist) artist = metadata.common.artist;
            if (metadata.common.album) album = metadata.common.album;
            if (metadata.format.duration) duration = metadata.format.duration;
          } catch (err) {
            console.error(`Error leyendo metadata de nuevo archivo ${filePath}:`, err);
          }

          state.tracks.push({
            id: Buffer.from(filePath).toString('base64'),
            title,
            artist,
            album,
            duration,
            filePath,
            urlPath: `/api/stream?path=${encodeURIComponent(filePath)}`,
            canvasPath: checkCanvasPath(filePath),
            mtimeMs: stat.mtime.getTime(),
            fileSize: stat.size,
            isUnavailable: false
          });
        }
      } catch (err) {
        console.error(`Error procesando archivo en escaneo ${filePath}:`, err);
      }
    }
  }

  saveLibraryState(state);
  return state;
}

function checkCanvasPath(filePath: string): string | undefined {
  const baseNoExt = filePath.replace(/\.[a-zA-Z0-9]+$/, '');
  const canvasMp4 = `${baseNoExt}.canvas.mp4`;
  const canvasJpg = `${baseNoExt}.canvas.jpg`;
  if (fs.existsSync(canvasMp4)) return canvasMp4;
  if (fs.existsSync(canvasJpg)) return canvasJpg;
  return undefined;
}

export function migrateCanvasPaths() {
  const state = getLibraryState();
  let modified = false;
  state.tracks = state.tracks.map(track => {
    const canvas = checkCanvasPath(track.filePath);
    if (track.canvasPath !== canvas) {
      modified = true;
      return { ...track, canvasPath: canvas };
    }
    return track;
  });
  if (modified) {
    saveLibraryState(state);
    console.log("✏️ Migración: canvasPath sincronizada en library_state.json");
  }
}

export function getLibrary() {
  return getLibraryState();
}

/**
 * Normaliza una cadena de texto eliminando mayúsculas, acentos, diacríticos
 * y caracteres de puntuación comunes para una búsqueda flexible.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita acentos/diacríticos
    .replace(/[()[\]{}"'.,\-–—_?!;:]/g, ' ') // Quita signos de puntuación y corchetes
    .replace(/\s+/g, ' ') // Reduce espacios múltiples
    .trim();
}

export interface LibraryQueryParams {
  q?: string;
  limit?: number;
  offset?: number;
  playlistId?: string;
}

export interface LibraryQueryResult {
  tracks: Track[];
  total: number;
  playlists: Playlist[];
}

/**
 * Consulta la biblioteca con filtros de playlist, búsqueda flexible por substring y paginación.
 */
export function queryLibrary(params: LibraryQueryParams): LibraryQueryResult {
  const state = getLibraryState();
  let tracks = state.tracks;

  // 1. Filtrar por playlist
  if (params.playlistId) {
    const playlist = state.playlists.find(p => p.id === params.playlistId);
    if (playlist) {
      const playlistTrackIds = new Set(playlist.trackIds);
      tracks = tracks.filter(t => playlistTrackIds.has(t.id));
    } else {
      tracks = [];
    }
  }

  // 2. Filtrar por términos de búsqueda (flexible a acentos y mayúsculas)
  if (params.q && params.q.trim()) {
    const terms = normalizeText(params.q).split(' ').filter(Boolean);
    if (terms.length > 0) {
      tracks = tracks.filter(track => {
        const normTitle = normalizeText(track.title);
        const normArtist = normalizeText(track.artist);
        const normAlbum = normalizeText(track.album || '');

        return terms.every(term =>
          normTitle.includes(term) ||
          normArtist.includes(term) ||
          normAlbum.includes(term)
        );
      });
    }
  }

  const total = tracks.length;

  // 3. Paginación
  const limit = params.limit !== undefined ? Number(params.limit) : 100;
  const offset = params.offset !== undefined ? Number(params.offset) : 0;
  const paginatedTracks = limit === -1 ? tracks.slice(offset) : tracks.slice(offset, offset + limit);

  return {
    tracks: paginatedTracks,
    total,
    playlists: state.playlists || []
  };
}

export function getTrackById(id: string): Track | undefined {
  const state = getLibraryState();
  return state.tracks.find(t => t.id === id);
}

export function createPlaylist(name: string, trackIds: string[] = []): Playlist {
  const state = getLibraryState();
  const newPlaylist: Playlist = {
    id: Math.random().toString(36).substring(2, 9),
    name,
    trackIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!state.playlists) state.playlists = [];
  state.playlists.push(newPlaylist);
  saveLibraryState(state);
  return newPlaylist;
}

export function deletePlaylist(id: string): boolean {
  const state = getLibraryState();
  if (!state.playlists) return false;
  const initialLength = state.playlists.length;
  state.playlists = state.playlists.filter(p => p.id !== id);
  if (state.playlists.length !== initialLength) {
    saveLibraryState(state);
    return true;
  }
  return false;
}

export function updatePlaylist(id: string, name?: string, trackIds?: string[]): Playlist | null {
  const state = getLibraryState();
  if (!state.playlists) return null;
  const playlist = state.playlists.find(p => p.id === id);
  if (playlist) {
    if (name !== undefined) playlist.name = name;
    if (trackIds !== undefined) playlist.trackIds = trackIds;
    playlist.updatedAt = new Date().toISOString();
    saveLibraryState(state);
    return playlist;
  }
  return null;
}

export function updateTrackLyrics(trackId: string, lyrics: string, syncedLyrics: string | null) {
  const state = getLibraryState();
  const track = state.tracks.find(t => t.id === trackId);
  if (track) {
    const lyricsPath = getLyricsPath(trackId);
    if (!fs.existsSync(lyricsDir)) {
      fs.mkdirSync(lyricsDir, { recursive: true });
    }
    fs.writeFileSync(lyricsPath, JSON.stringify({ lyrics, syncedLyrics }, null, 2), 'utf-8');
    return true;
  }
  return false;
}

// Ejecutar la migración de letras al cargar el servicio para limpiar el library_state.json histórico
try {
  migrateLyricsToFiles();
} catch (err) {
  console.error('[Library] Error al inicializar migración de letras:', err);
}
