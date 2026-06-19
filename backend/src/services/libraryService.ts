import fs from 'fs';
import path from 'path';

const statePath = path.join(__dirname, '..', 'library_state.json');

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
}

export interface LibraryState {
  playlists: any[];
  tracks: Track[];
}

function getLibraryState(): LibraryState {
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  }
  return { playlists: [], tracks: [] };
}

function saveLibraryState(state: LibraryState) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

import * as mm from 'music-metadata';

/**
 * Escanea recursivamente un directorio buscando mp3 o flac.
 */
function scanDirectoryRecursively(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDirectoryRecursively(fullPath, fileList);
    } else {
      if (file.endsWith('.flac') || file.endsWith('.mp3')) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

/**
 * Escanea y actualiza la biblioteca local asíncronamente.
 */
export async function scanAndSyncLibrary(folderPaths: string[]): Promise<LibraryState> {
  const state = getLibraryState();
  const newTracks: Track[] = [];

  for (const folder of folderPaths) {
    const audioFiles = scanDirectoryRecursively(folder);
    
    for (const filePath of audioFiles) {
      if (state.tracks.some(t => t.filePath === filePath)) continue;
      
      const fileName = path.basename(filePath);
      let title = fileName.replace(/\.(mp3|flac)$/, '');
      let artist = 'Artista Desconocido';
      let album = 'Álbum Local';

      try {
        const metadata = await mm.parseFile(filePath);
        if (metadata.common.title) title = metadata.common.title;
        if (metadata.common.artist) artist = metadata.common.artist;
        if (metadata.common.album) album = metadata.common.album;
      } catch (err) {
        console.error(`Error leyendo metadata de ${filePath}:`, err);
      }

      newTracks.push({
        id: Buffer.from(filePath).toString('base64'),
        title: title,
        artist: artist,
        album: album,
        filePath: filePath,
        urlPath: `/api/stream?path=${encodeURIComponent(filePath)}`,
        canvasPath: checkCanvasPath(filePath)
      });
    }
  }

  state.tracks = [...state.tracks, ...newTracks];
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

export function updateTrackLyrics(trackId: string, lyrics: string, syncedLyrics: string | null) {
  const state = getLibraryState();
  const track = state.tracks.find(t => t.id === trackId);
  if (track) {
    track.lyrics = lyrics;
    track.syncedLyrics = syncedLyrics || undefined;
    saveLibraryState(state);
    return true;
  }
  return false;
}
