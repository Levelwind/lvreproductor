import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as mm from 'music-metadata';

export interface CoverResult {
  contentType: string;
  data: Buffer;
}

export interface CoverRedirect {
  redirectUrl: string;
}

/**
 * Obtiene la carátula de una canción (local, incrustada, iTunes o Deezer)
 */
export async function getCover(audioPath: string, forceSearch: boolean): Promise<CoverResult | CoverRedirect | null> {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return null;
  }

  const dir = path.dirname(audioPath);

  if (forceSearch) {
    return handleOnlineCoverSearch(audioPath);
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
        return { contentType: fmt.mime, data: imgData };
      }
    }

    const metadata = await mm.parseFile(audioPath);
    const hasEmbedded = metadata.common.picture && metadata.common.picture.length > 0;

    // 2. Si hay carátula incrustada y es de buena calidad (> 30 KB), la usamos directamente
    if (hasEmbedded) {
      const picture = metadata.common.picture![0];
      if (picture.data.length > 30720) {
        return { contentType: picture.format, data: picture.data };
      }
    }

    // 3. Si no, buscar online
    return handleOnlineCoverSearch(audioPath, hasEmbedded ? metadata.common.picture![0] : undefined);
  } catch (error) {
    console.error('Error extrayendo o buscando carátula:', error);
    return null;
  }
}

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

async function handleOnlineCoverSearch(audioPath: string, fallbackPicture?: mm.IPicture): Promise<CoverResult | CoverRedirect | null> {
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
      imageUrl = await searchItunesCover(query);
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

          return { contentType: 'image/jpeg', data: imgBuffer };
        } catch (dlError) {
          console.error('Error al descargar y guardar la carátula en disco:', dlError);
          return { redirectUrl: imageUrl };
        }
      }
    }
  } catch (searchErr) {
    console.error('Error en búsqueda online de carátula:', searchErr);
  }

  // Fallback si no se encontró en línea
  if (fallbackPicture) {
    return { contentType: fallbackPicture.format, data: fallbackPicture.data };
  }

  return null;
}
