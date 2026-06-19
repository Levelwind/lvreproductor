import { scanAndSyncLibrary } from './src/services/libraryService';

console.log('Iniciando prueba de escaneo de música local...');
const musicFolder = 'C:\\Users\\Sebas\\Music';

try {
  const result = scanAndSyncLibrary([musicFolder]);
  console.log(`¡Escaneo exitoso! Se encontraron y sincronizaron ${result.tracks.length} canciones.`);
  
  if (result.tracks.length > 0) {
    console.log('Ejemplo 1:', result.tracks[0].title);
    if (result.tracks.length > 1) {
      console.log('Ejemplo 2:', result.tracks[1].title);
    }
  }
} catch (err: any) {
  console.error('Ocurrió un error al escanear:', err.message);
}
