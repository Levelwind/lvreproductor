/**
 * Spotify Service - STUBBED & BLOCKED
 * 
 * Spotify integration has been disabled to prevent token expiration crashes and WAF protection blocks.
 * All metadata operations are now routed through Tidal (via Python) or public token-free engines (iTunes / Deezer).
 */

export async function getSpotifyMetadata(url: string): Promise<any> {
  throw new Error("La extracción de metadatos de Spotify está desactivada. Por favor, busca la canción por texto o usa un enlace de Tidal.");
}

export async function searchSpotifyCover(query: string): Promise<string | null> {
  console.log('[Spotify Service] Cover search is disabled. Falling back to Deezer/iTunes.');
  return null;
}

export async function fetchSpotifyLyrics(artist: string, title: string, spotifyTrackId?: string): Promise<{ synced: boolean, lyrics: string }> {
  throw new Error("La búsqueda de letras en Spotify está desactivada. Las letras ahora se obtienen de forma gratuita e ilimitada a través de LRCLIB.");
}
