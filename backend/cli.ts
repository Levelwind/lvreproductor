import { downloadTrack } from './src/services/downloadService';
import { scanAndSyncLibrary } from './src/services/libraryService';
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
  npx ts-node cli.ts check-tokens
  npx ts-node cli.ts scan <ruta>
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

      default:
        console.log(`Comando desconocido: ${command}`);
    }
  } catch (error: any) {
    console.error('[CLI ERROR]', error.message);
  }
}

main();
