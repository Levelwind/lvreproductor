import { getCleanMetadata, searchLrclib, formatLrclibResult } from './lrclibService';
import { updateTrackLyrics, getTrackLyrics } from './libraryService';

export interface SyncResult {
  title: string;
  artist: string;
  status: 'synced' | 'plain' | 'failed' | 'skipped';
  source: string;
}

export interface SyncProgress {
  running: boolean;
  total: number;
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  currentTrack: string;
  results: SyncResult[];
}

class LyricsSyncService {
  private progress: SyncProgress = {
    running: false,
    total: 0,
    processed: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    currentTrack: '',
    results: []
  };

  private abortFlag = false;

  public getProgress(): SyncProgress {
    return { ...this.progress, results: [...this.progress.results] };
  }

  public stopSync(): boolean {
    if (!this.progress.running) return false;
    this.abortFlag = true;
    return true;
  }

  public startSync(tracks: any[], mode: 'missing' | 'unsynced' | 'all') {
    if (this.progress.running) {
      throw new Error('Ya hay una sincronización en curso');
    }

    let tracksToSync = tracks;

    if (mode === 'missing') {
      tracksToSync = tracks.filter(t => {
        const lyr = getTrackLyrics(t.id);
        return !lyr.lyrics && !lyr.syncedLyrics;
      });
    } else if (mode === 'unsynced') {
      tracksToSync = tracks.filter(t => {
        const lyr = getTrackLyrics(t.id);
        const synced = lyr.syncedLyrics || '';
        return !synced || !/\[\d{2}:\d{2}/.test(synced);
      });
    }

    this.progress = {
      running: true,
      total: tracksToSync.length,
      processed: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      currentTrack: '',
      results: []
    };
    this.abortFlag = false;

    // Ejecutar en segundo plano
    (async () => {
      for (const track of tracksToSync) {
        if (this.abortFlag) {
          console.log('[SYNC-ALL] Sincronización detenida por el usuario.');
          break;
        }

        const { artist: cleanArtist, title: cleanTitle } = getCleanMetadata(track.title, track.artist, track.filePath);
        this.progress.currentTrack = `${cleanArtist} - ${cleanTitle}`;

        try {
          // Intentar buscar en LRCLIB
          const lrclibResult = await searchLrclib(cleanTitle, cleanArtist, track.filePath);

          if (lrclibResult && (lrclibResult.syncedLyrics || lrclibResult.plainLyrics)) {
            const formatted = formatLrclibResult(lrclibResult);
            updateTrackLyrics(track.id, formatted.plainLyrics, formatted.syncedLyrics);

            this.progress.synced++;
            this.progress.results.push({
              title: cleanTitle,
              artist: cleanArtist,
              status: formatted.synced ? 'synced' : 'plain',
              source: 'LRCLIB'
            });
            console.log(`[SYNC] ✓ ${cleanArtist} - ${cleanTitle} (LRCLIB, ${formatted.synced ? 'synced' : 'plain'})`);
          } else {
            this.progress.failed++;
            this.progress.results.push({
              title: track.title,
              artist: track.artist,
              status: 'failed',
              source: 'none'
            });
            console.log(`[SYNC] ✗ ${track.artist} - ${track.title} (no encontrada en LRCLIB)`);
          }
        } catch (err: any) {
          this.progress.failed++;
          this.progress.results.push({
            title: track.title,
            artist: track.artist,
            status: 'failed',
            source: 'error'
          });
          console.error(`[SYNC] Error en ${track.title}:`, err.message);
        }

        this.progress.processed++;

        // Pequeña pausa para no abusar de las APIs (200ms entre peticiones)
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      this.progress.running = false;
      this.progress.currentTrack = '';
      console.log(`[SYNC-ALL] Completado: ${this.progress.synced} sincronizadas, ${this.progress.failed} fallidas de ${this.progress.total} total`);
    })();
  }
}

export default new LyricsSyncService();
