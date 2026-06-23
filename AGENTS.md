# 🤖 AI Agent Context & Guide (AGENTS.md)

Este archivo sirve como memoria rápida para cualquier IA que trabaje en este repositorio. Léelo antes de realizar cualquier cambio para evitar leer archivos innecesarios y saturar el contexto.

---

## 🎯 Resumen del Proyecto
**Level Player** es un reproductor de música local (web/escritorio) con un descargador multimedia integrado que obtiene metadatos de iTunes/Deezer y descargas de audio de alta calidad (HiFi FLAC/AAC) desde Tidal. La integración con Spotify está **desactivada** (archivos conservados pero imports comentados y endpoints devuelven 410).

## 🛠️ Stack Tecnológico
*   **Frontend**: React + Vite (TypeScript) + Howler.js (para reproducción remota opcional en navegador)
*   **Backend**: Node.js (TypeScript) + Express (API orquestadora local)
*   **Reproductor Local Nativo**: `MPD` (Music Player Daemon 0.22.4) controlado vía sockets TCP a través de `127.0.0.1:6600`. Soporta WASAPI Exclusive (`exclusive "yes"`), gapless audio, crossfade y ReplayGain.
*   **Descargas**: Scripts de Python independientes (ejecutados como subprocesos por Node.js)
*   **Metadatos**: `music-metadata` (Node.js) + inyección directa de tags + APIs públicas (Deezer, iTunes)
*   **Letras**: LRCLIB (primario, gratuito) + Deezer Fuzzy Matcher (corrección de metadatos)
*   **Base de datos**: **Ninguna** (Se escanea el directorio local en tiempo real y se guarda el estado de biblioteca y playlists en `library_state.json` local. El archivo de estado utiliza control de versiones (Versión 2 en adelante) para evitar corrupciones y permitir migraciones automatizadas. Las letras sincronizadas y sin sincronizar se guardan por separado en archivos JSON individuales dentro de `/backend/src/lyrics/` utilizando el hash SHA-256 de la ID de la canción para mantener el archivo de estado ligero).

---

## 📂 Estructura del Proyecto
*   [`/frontend`](file:///c:/Users/Sebas/level-player/frontend): Interfaz de usuario en React.
*   [`/backend`](file:///c:/Users/Sebas/level-player/backend): Servidor local en Node.js que maneja archivos, configuraciones y el reproductor nativo MPD.
*   [`/scripts`](file:///c:/Users/Sebas/level-player/scripts): Scripts de Python para descargas de Spotify Canvas y música de Tidal.
*   [`/variadas`](file:///c:/Users/Sebas/level-player/variadas): Recursos de inspiración e imágenes de referencia (ver regla de acceso).

### 📦 Componentes del Frontend (Modularizados)
El panel principal (`MainContent.tsx`) actúa como un **enrutador de pestañas** que delega a subcomponentes independientes:

| Componente | Archivo | Responsabilidad |
|---|---|---|
| **MainContent** | `MainContent.tsx` | Enrutador de pestañas (Música, Descargar, Ajustes), carga de biblioteca y config, búsqueda fuzzy con Fuse.js, selección de playlists |
| **TrackTable** | `TrackTable.tsx` | Lista de canciones de la biblioteca/playlist, highlight de pista activa, trigger de reproducción, botones para añadir/quitar de playlists |
| **DownloadPanel** | `DownloadPanel.tsx` | Descarga vía Tidal o búsqueda de texto, preview de metadatos con debounce, barra de progreso |
| **SettingsPanel** | `SettingsPanel.tsx` | Configuración de tokens (Tidal, YouTube), campo Spotify desactivado visualmente, integra `LyricsSyncPanel` |
| **LyricsSyncPanel** | `LyricsSyncPanel.tsx` | Sincronización masiva de letras vía LRCLIB, polling de progreso, selectores de modo |
| **FullscreenPlayer** | `FullscreenPlayer.tsx` | Modo cine con letras sincronizadas (LRC), carátula con extracción de color, controles de reproducción |
| **PlayerBar** | `PlayerBar.tsx` | Barra inferior de reproducción (mini-player) |
| **Sidebar** | `Sidebar.tsx` | Panel lateral de navegación con gestión y creación de playlists |
| **CanvasPanel** | `CanvasPanel.tsx` | Panel de video Canvas |

### 🔌 Hooks Personalizados
| Hook | Archivo | Responsabilidad |
|---|---|---|
| **useColorExtractor** | `hooks/useColorExtractor.ts` | Extrae colores dominantes de la carátula para gradientes adaptativos |
| **useLyrics** | `hooks/useLyrics.ts` | Busca letras: primero local (`/api/lyrics`), luego LRCLIB online como fallback |
| **usePlayer** / **PlayerProvider** | `context/PlayerContext.tsx` | Administra el estado de reproducción y se sincroniza con el backend (control local MPD vía SSE y fetch/POST) o usa Howler de fallback |

### ⚙️ Servicios del Backend
| Servicio | Archivo | Responsabilidad |
|---|---|---|
| **index.ts** | `src/index.ts` | Servidor Express principal con endpoints de biblioteca, streaming, carátulas, letras, descargas, configuración y API del reproductor `/api/player/*` |
| **libraryService** | `src/services/libraryService.ts` | Escaneo de carpetas, playlists, guardado en `library_state.json`, almacenamiento individual de letras en `/backend/src/lyrics/` |
| **playerService** | `src/services/playerService.ts` | Controla la instancia local de `mpd.exe`, gestiona eventos por sockets TCP, maneja transiciones, pre-cargas de audio y clientes SSE |
| **coverService** | `src/services/coverService.ts` | Extrae carátulas de audio local (metadatos incrustados) o busca de forma activa y automatizada en iTunes/Deezer |
| **lyricsSyncService** | `src/services/lyricsSyncService.ts` | Sincronizador masivo en segundo plano que busca letras ausentes o no-sincronizadas en LRCLIB |
| **lrclibService** | `src/services/lrclibService.ts` | Motor de letras: LRCLIB + Deezer Fuzzy + `getCleanMetadata()` |
| **spotifyService** | `src/services/spotifyService.ts` | ⚠️ **DESACTIVADO** — Stubs que lanzan excepciones. Import comentado en `index.ts`. Archivo conservado por si se reactiva. |

---

## 🚫 Estado de Spotify (DESACTIVADO)
La integración con Spotify está **completamente desactivada** en el sistema:
*   **Backend**: El import de `spotifyService` está comentado en `index.ts`. El endpoint `/api/lyrics/spotify/sync` devuelve HTTP `410 Gone`.
*   **Frontend**: El campo `Spotify sp_dc Cookie` está greyed-out/disabled en `SettingsPanel.tsx`, pero su valor se conserva en `config.json`.
*   **CLI**: El comando `check-tokens` ya no intenta hacer ping a Spotify.
*   **Scripts Python**: Los scripts `descargar_single.py` y `sync_canvases.py` siguen intactos y pueden usarse manualmente si se configura `sp_dc`/`accessToken` en `config.json`.
*   **Regla**: NO reactivar la integración de Spotify en el backend/frontend sin instrucción explícita del usuario. Los metadatos y carátulas se obtienen de Deezer e iTunes. Las letras se obtienen de LRCLIB.

---

## 🛑 Errores Históricos y Reglas Estrictas (¡Evita cometerlos!)

1.  **NO usar Bases de Datos tradicionales (PostgreSQL, SQLite, MySQL):** El proyecto es de uso personal y local. Todo se gestiona leyendo directamente el sistema de archivos (`fs`) y guardando playlists/configuración en un archivo JSON local (`library_state.json` y `config.json`).
2.  **NO reescribir el motor de descargas en JS:** La descarga de Tidal y el scrapping de Spotify ya funcionan de forma nativa y robusta en tus scripts de Python. El backend de Node.js **debe llamarlos como subprocesos** en lugar de intentar migrarlos a JavaScript.
3.  **NO integrar dependencias mágicas de IA en la ejecución de la app:** Todo el flujo lógico debe ser clásico, secuencial y predecible para que los errores sean fáciles de capturar mediante try/catch lógicos.
4.  **Cuidado con la expiración de Cookies/Tokens:** Las cookies de Spotify (`sp_dc`) y los tokens de Tidal expiran con frecuencia. Los scripts de Python no deben tener estos valores quemados (hardcoded); deben leerlos desde el archivo de configuración central `config.json` compartido por el backend de Node.js.
5.  **Bucle Infinito de Nodemon (`ERR_CONNECTION_RESET`):** Nunca dejes que archivos mutables y autogenerados (como `library_state.json` o la carpeta `lyrics/`) sean vigilados por `nodemon`. Si el servidor re-escribe su propia base de datos local y `nodemon` lo detecta, el servidor se reiniciará en medio de peticiones HTTP provocando crasheos en el frontend.
6.  **Protección WAF de Spotify (Error 403 URL Blocked):** Spotify actualizó su servidor Varnish/Cloudflare. Ya NO es posible extraer el `accessToken` automáticamente usando `sp_dc` mediante Python `urllib` o scripts básicos (arrojará 403). Para la sincronización de Canvas, la única forma de evitar el baneo es exigir al usuario que pegue su `accessToken` directamente en `config.json` tras extraerlo manualmente desde su navegador.
7.  **Renderizado Seguro de Carátulas (Rutas Locales vs CSS):** Cuando envíes rutas absolutas de Windows (con barras, espacios o tildes) a través de tu endpoint `/api/cover`, **NO** uses `backgroundImage: url(...)` en React. Falla silenciosamente al procesar URLs codificadas. Utiliza siempre etiquetas reales `<img src={...} />` para garantizar que la carátula aparezca en el reproductor.
8.  **Soporte Multiformato de Carátulas Locales:** El endpoint `/api/cover` detecta carátulas en la carpeta de la canción buscando `cover.jpg`, `cover.png` y `cover.webp` en orden de prioridad. Evita forzar una sola extensión (.jpg) para no requerir renombramientos innecesarios.
9. **Motor de Sincronización de Letras (LRCLIB + Deezer Fuzzy):**
    *   **LRCLIB**: Es la fuente de letras primaria por ser libre de tokens, gratuita y sin rate limits.
    *   **Deezer Fuzzy Matcher**: Si LRCLIB no encuentra resultados debido a errores tipográficos o metadatos de archivos sucios (como track numbers `05 Rickets` o typos `Rikcets`), se usa la API de búsqueda difusa de Deezer para resolver los metadatos correctos y reintentar la búsqueda en LRCLIB con los nombres saneados.
    *   **Spotify**: ⚠️ **DESACTIVADO** — El fallback de Spotify está desactivado. Si se reactiva en el futuro, leería credenciales desde `config.json`.
    *   **Limpieza de Metadatos**: La función `getCleanMetadata` resuelve artistas desconocidos leyendo la estructura de carpetas local (`.../Artista/Album/Cancion.mp3`) y limpia caracteres especiales e IDs de YouTube. Mantén esta limpieza centralizada al buscar letras.
10. **NO mutar estilos del DOM directamente en React (`onError`):** Para ocultar imágenes fallidas (como carátulas), no uses `e.currentTarget.style.display = 'none'`. React reutiliza los nodos del DOM al renderizar, lo que deja el estilo `display: none` atascado permanentemente al cambiar de canción. Utiliza siempre estados de React (`coverError`) y añade `key={currentTrack?.id}` en las imágenes para forzar su desmontado y reinicialización al cambiar de pista.
11. **Ocultamiento Total bajo Modo Cine (`isFullscreen`):** Para evitar que los paneles subyacentes se filtren (bleeding de 1px) en pantallas con escalado de DPI debido a redondeos de subpíxeles del navegador, oculta el diseño estándar (`Sidebar`, `MainContent`, `CanvasPanel`) con `display: none` y desmonta la barra inferior `PlayerBar` cuando `isFullscreen` sea `true`. Esto también conserva recursos de renderizado.
12. **Evitar `transparent` genérico en degradados layered:** Para evitar bandas de color grisáceas o sombras horizontales molestas (banding de gradiente) al interpolar colores semi-transparentes (ej: de `rgba(255,255,255,0.3)` a transparente), no uses la palabra clave `transparent` directamente (algunos navegadores la interpretan como `rgba(0,0,0,0)` interpolando a gris). En su lugar, usa el mismo color base con opacidad cero: `rgba(255, 255, 255, 0)` o `rgba(0, 0, 0, 0)`.
13. **Desactivación total de Spotify en el reproductor:** La integración de Spotify está desactivada a nivel de backend (imports comentados, endpoint 410), frontend (campo sp_dc disabled) y CLI (check-tokens desactivado). El motor de letras usa exclusivamente LRCLIB + Deezer Fuzzy. NO reactivar sin instrucción explícita del usuario.
14. **Arquitectura modular del frontend:** `MainContent.tsx` es un enrutador de pestañas ligero. Cada panel (TrackTable, DownloadPanel, SettingsPanel, LyricsSyncPanel) es un componente independiente con su propio estado. Al modificar un panel, edita solo su archivo correspondiente sin tocar MainContent.tsx. Los datos compartidos (tracks, config) se pasan como props desde MainContent.
15. **RESTRICCIÓN DE LECTURA DE CARPETAS DE INSPIRACIÓN ("reproductores inspo"):** A menos que se mencione explícitamente la frase `"buscar en reproductores inspo"` para buscar módulos o componentes que puedan servir, el Agente de IA **NO** debe leer ni explorar el directorio `/variadas/reproductores de audio inspo` (o cualquier archivo/directorio bajo `/variadas`) a menos que el usuario lo indique expresamente en el prompt actual.
16. **Ciclo de Desarrollo en Fases (Preguntas, Planificación y Ejecución):** Para cualquier corrección de errores (bugfixes) o nuevas implementaciones, el agente siempre debe: (a) Realizar preguntas aclaratorias al usuario si existen dudas de comportamiento, (b) Elaborar una planificación detallada de los archivos y cambios antes de tocar código, y (c) Ejecutar los cambios de forma incremental y ordenada, validando la compilación en cada paso para asegurar un proceso de desarrollo óptimo.
17. **Escaneo Rápido Incremental (Comparación Física):** El escaneo evita re-analizar los metadatos de las canciones en `library_state.json` si el archivo ya existe y su marca de tiempo (`mtimeMs`) y tamaño (`fileSize`) coinciden con el estado guardado.
18. **Flag de Disponibilidad de Pistas (`isUnavailable`):** Las canciones que no existan en disco durante el escaneo no se borran de `library_state.json` (evitando pérdida accidental de playlists/letras). En su lugar, se marcan con `isUnavailable = true`. Visualmente en `TrackTable.tsx`, se representan con opacidad reducida (`0.4`), cursor `not-allowed`, click deshabilitado, y un icono de `AlertCircle` indicando que el archivo no está disponible.
19. **Soluciones de Largo Alcance (Evitar Parches Temporales):** Las soluciones de diseño deben ser robustas y de largo alcance. Se prohíbe el uso de "parches de cinta adhesiva" o constantes estáticas arbitrarias que limiten el escalamiento futuro. *Ejemplo:* En lugar de usar números hardcodeados como `limit: 50000` para cargar canciones, utilizar configuraciones dinámicas de la API (como `limit: -1`) para adaptarse automáticamente al volumen total real de datos.
