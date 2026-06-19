# Sistema de Descarga de Música

Sistema para descargar música en FLAC lossless desde **Tidal** y **Qobuz**, con herramientas de mantenimiento, deduplicación y reparación de archivos.

## Requisitos

- Python 3.13+
- ffmpeg / ffprobe (en PATH)
- Dependencias: `pip install tidal-dl qobuz-dl mutagen tqdm yt-dlp`

## Estructura

```
C:\Users\Sebas\Music\
├── scripts/
│   ├── README.md                   ← Este archivo
│   ├── AGENTS.md                   ← Instrucciones para IA
│   ├── tidal_download_common.py    ← Config compartida Tidal
│   ├── descargar_artistas.py       ← Descarga artistas completos
│   ├── descargar_links_sueltos.py  ← Descarga tracks/albums/playlists
│   ├── links_artistas.txt          ← Input: URLs de artistas
│   ├── links_sueltos.txt           ← Input: URLs sueltas
│   ├── fix_tidal_files.py          ← Repara FLACs con container incorrecto
│   ├── convert_alac_to_flac.py     ← Convierte ALAC a FLAC
│   ├── download_buhodermia.py      ← Descarga desde YouTube
│   ├── qobuz_download.py           ← Descarga directa Qobuz
│   ├── setup_qobuz.py              ← Setup de Qobuz
│   ├── Tidal-Media-Downloader/     ← Dependencia tidal-dl (git)
│   ├── qobuz-dl/                   ← Dependencia qobuz-dl (git)
│   ├── NebulaPlayer/               ← Web app reproductor (Vite)
│   └── scratch/                    ← Scripts utilitarios one-off
│       ├── login_interactive.py    ← OAuth Tidal (obtener token)
│       ├── update_token_direct.py  ← Actualizar token manualmente
│       ├── delete_all_duplicates.py← Deduplicación global
│       ├── reorganize_and_dedup.py ← Consolidar + deduplicar
│       ├── descargar_deftones_smart.py      ← Smart downloader con progreso
│       ├── descargar_limp_bizkit_smart.py   ← Smart downloader con IDs curados
│       ├── descargar_letras_deftones.py     ← Descargar letras .lrc
│       ├── check_tidal_links_local.py       ← Verificar descargas locales
│       └── ... (~55 scripts)
│
└── Alta y Media Calidad/           ← Biblioteca de música descargada
    └── {ArtistName}/
        └── {AlbumTitle}/
            ├── {ArtistName} - {TrackTitle}.flac
            └── {ArtistName} - {TrackTitle}.lrc
```

## Flujo de Descarga (Tidal)

1. **Input**: URLs en `links_artistas.txt` (artistas) o `links_sueltos.txt` (tracks/albums/playlists)
2. **Autenticación**: `tidal_download_common.py` lee el token guardado en `~/.tidal-dl.token.json`
3. **Config**: Calidad `Max` (FLAC Master), ruta `Alta y Media Calidad`, formato `{ArtistName} - {TrackTitle}`, checkExist=true, lyricFile=true, saveCovers=true
4. **Ejecución**: `tidal_dl.events.start(url)` descarga automáticamente detectando el tipo de URL
5. **Output**: FLAC + .lrc en la estructura de carpetas indicada
6. **Reintentos**: Hasta 5 intentos con backoff (15s, 30s, 60s, 120s, 300s)
7. **Post-procesamiento**: `fix_tidal_files.py` reemplantea FLACs que Tidal etiquetó incorrectamente (MP4→FLAC)

## Autenticación Tidal

- **Obtener token**: Ejecutar `scratch/login_interactive.py` — abre URL en navegador, autorizar, token se guarda automáticamente
- **Actualizar token manual**: Editar el token JWT en `scratch/update_token_direct.py` (variable `NEW_TOKEN`) y ejecutarlo
- **Tokens expuestos**: También hardcodeados en scripts como `debug_token.py`, `debug_token_v2.py`, `list_tracks.py`, `count_total_tracks.py`, `count_mac_demarco.py`, `descargar_deftones_faltantes.py`, `verify_missing.py`, `verify_missing_v2.py`, `test_token.py`, `test_token_current.py`
- **Audiencia**: User ID `208344465`, País `CO`
- **API Keys**: 5 sets en `Tidal-Media-Downloader/TIDALDL-PY/tidal_dl/apiKey.py` (Fire TV, Android TV, TV, Android Auto)

## Autenticación Qobuz

- **Setup**: Ejecutar `setup_qobuz.py` — obtiene app_id y secrets dinámicamente
- **Login**: Email + password, hash MD5 para la contraseña
- **Config**: `%APPDATA%/qobuz-dl/config.ini`

## Mantenimiento

| Script | Función |
|--------|---------|
| `fix_tidal_files.py` | Detecta FLACs falsos (container MP4) y los remuxe a FLAC real con ffmpeg |
| `convert_alac_to_flac.py` | Convierte ALAC (.m4a) a FLAC |
| `delete_all_duplicates.py` | Escanea toda la biblioteca, agrupa por título+artista+duración, elimina archivos de menor calidad (FLAC > M4A > MP3) |
| `reorganize_and_dedup.py` | Consolida carpetas de artista específico + deduplicación |
| `check_headers.py` | Verifica magic bytes `fLaC` en archivos |
| `descargar_letras_deftones.py` | Busca y descarga letras .lrc para archivos existentes |
| `audit_local_music.py` | Compara archivos locales contra listas de tracks esperadas |

## Formatos y Prioridad de Calidad

FLAC > WAV/ALAC > M4A/AAC > MP3 > OGG > OPUS

La biblioteca apunta a 100% FLAC lossless. Los scripts de deduplicación eliminan formatos inferiores automáticamente.

## Estrategias de Descarga por Artista

- **Simple** (`descargar_artistas.py`): Descarga discografía completa vía `tidal_dl.events.start(url)`. Sin filtros.
- **Smart** (`descargar_deftones_smart.py`): Analiza álbumes, normaliza títulos, elige versión Deluxe (más tracks), omite compilaciones, guarda progreso en JSON para reanudar.
- **Curada** (`descargar_limp_bizkit_smart.py`): Lista hardcodeada de album IDs, delay adaptativo (0.5s si skip, 4s si descarga real).

## Convenciones

- **Idioma**: Español (variables, comentarios, mensajes)
- **Formato track**: `{ArtistName} - {TrackTitle}.flac`
- **Formato carpeta**: `{ArtistName}/{AlbumTitle}/`
- **Ruta base**: `C:\Users\Sebas\Music\Alta y Media Calidad`
- **Letras**: `.lrc` junto al FLAC, mismo nombre base
- **Portadas**: Incrustadas en metadatos FLAC
- **Carátulas**: Guardadas como archivos de imagen en la carpeta del álbum

## Archivos de Input/Output

| Archivo | Propósito |
|---------|-----------|
| `links_artistas.txt` | URLs de artistas Tidal (1 por línea) — se limpia al terminar |
| `links_sueltos.txt` | URLs de tracks/albums/playlists — se limpia al terminar |
| `fallos_artistas.txt` | URLs que fallaron después de reintentos |
| `fallos_sueltos.txt` | URLs sueltas que fallaron |
| `~/.tidal-dl.token.json` | Token Tidal (base64) |
| `~/.tidal-dl.json` | Config de tidal-dl |
| `deftones_progress.json` | Progreso de descarga de Deftones (reanudable) |

## Instrucciones para IA (Agents.md)

Este README contiene la documentación del sistema. Un archivo `AGENTS.md` separado (en el mismo directorio) contiene reglas específicas de comportamiento para asistentes de IA que interactúen con este sistema.

**Regla principal**: Cuando un asistente IA descargue un track (o ejecute cualquier script que resulte en una descarga), DEBE notificar al usuario con el mensaje:

> "Se descargó: {ArtistName} — {TrackTitle}"

Esto aplica para cualquier script en este repositorio que resulte en una descarga de música, ya sea desde Tidal, Qobuz, YouTube, o cualquier otra fuente.

## Notas

- Tidal a veces descarga archivos con extensión `.flac` que en realidad son MP4 (ALAC o lossy). `fix_tidal_files.py` detecta esto por el atom `ftyp` en el header y los remuxe.
- El token JWT de Tidal expira periódicamente. Se puede refrescar con `login_interactive.py` o actualizar manualmente en los scripts que lo tienen hardcodeado.
- Delay entre descargas: 2s por defecto, 4s en smart downloaders cuando hay descarga real, 0.5s cuando el track ya existe.
