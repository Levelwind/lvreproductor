import { downloadTrack } from './src/services/downloadService';
import { scanAndSyncLibrary } from './src/services/libraryService';
import axios from 'axios';
// [DESACTIVADO] import de Spotify — se conserva el archivo pero no se usa.
// import { getSpotifyMetadata } from './src/services/spotifyService';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
🎸 Level Player CLI
Uso:
  npx ts-node cli.ts download <url_tidal_o_busqueda>
  npx ts-node cli.ts scan <ruta>
  npx ts-node cli.ts check-tokens

  Controles de reproducción (Remoto):
  npx ts-node cli.ts play
  npx ts-node cli.ts pause
  npx ts-node cli.ts next
  npx ts-node cli.ts prev
  npx ts-node cli.ts volume <0-100>
  npx ts-node cli.ts seek <segundos>
  npx ts-node cli.ts status
    `);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'download':
        const url = args[1];
        if (!url) throw new Error('Debes proporcionar una URL. Ej: download https://open.spotify.com/...');
        console.log(`[CLI] Iniciando descarga para: ${url}`);
        const result = await downloadTrack(url, false);
        console.log('[CLI] Resultado:', result);
        break;

      case 'scan':
        const folderPath = args[1];
        if (!folderPath) throw new Error('Debes proporcionar una ruta. Ej: scan "C:\\Users\\Sebas\\Music"');
        console.log(`[CLI] Escaneando ruta: ${folderPath}`);
        const scanResult = scanAndSyncLibrary([folderPath]);
        console.log(`[CLI] Se sincronizaron ${scanResult.tracks.length} canciones en la biblioteca.`);
        break;

      case 'check-tokens':
        // [DESACTIVADO] La verificación de tokens de Spotify ya no está disponible.
        console.log('[CLI] ⚠️ La verificación de tokens de Spotify está desactivada.');
        console.log('[CLI] ⚠️ Los tokens de Tidal/Qobuz debes validarlos desde los scripts de Python.');
        break;

      case 'play':
        await axios.post('http://localhost:4000/api/player/play');
        console.log('[CLI] Reproducción iniciada/reanudada.');
        break;

      case 'pause':
        await axios.post('http://localhost:4000/api/player/pause');
        console.log('[CLI] Reproducción pausada.');
        break;

      case 'next':
        await axios.post('http://localhost:4000/api/player/next');
        console.log('[CLI] Siguiente canción.');
        break;

      case 'prev':
        await axios.post('http://localhost:4000/api/player/prev');
        console.log('[CLI] Anterior canción.');
        break;

      case 'volume':
        const vol = parseFloat(args[1]);
        if (isNaN(vol) || vol < 0 || vol > 100) throw new Error('Volumen debe ser entre 0 y 100');
        await axios.post('http://localhost:4000/api/player/volume', { volume: vol / 100 });
        console.log(`[CLI] Volumen establecido a: ${vol}%`);
        break;

      case 'seek':
        const sec = parseInt(args[1]);
        if (isNaN(sec)) throw new Error('Posición debe ser un número entero de segundos');
        await axios.post('http://localhost:4000/api/player/seek', { seconds: sec });
        console.log(`[CLI] Buscando posición: ${sec}s`);
        break;

      case 'status':
        const statusRes = await axios.get('http://localhost:4000/api/player/state');
        const state = statusRes.data;
        if (state && state.currentTrack) {
          console.log(`[CLI] Estado: ${state.isPlaying ? '▶️ Reproduciendo' : '⏸️ Pausado'}`);
          console.log(`[CLI] Pista: ${state.currentTrack.title} - ${state.currentTrack.artist}`);
          if (state.currentTrack.album) console.log(`[CLI] Álbum: ${state.currentTrack.album}`);
          console.log(`[CLI] Progreso: ${Math.floor(state.progress)}s / ${Math.floor(state.duration)}s`);
          console.log(`[CLI] Volumen: ${Math.round(state.volume * 100)}%`);
        } else {
          console.log('[CLI] Ninguna pista en reproducción actualmente.');
        }
        break;

      default:
        console.log(`Comando desconocido: ${command}`);
    }
  } catch (error: any) {
    console.error('[CLI ERROR]', error.message);
  }
}

main();
