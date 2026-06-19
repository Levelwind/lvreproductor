#!/usr/bin/env python
# -*- encoding: utf-8 -*-
import sys
import argparse
import json
import urllib.request
import re
import os

sys.path.insert(0, r"C:\Users\Sebas\level-player\scripts")
sys.path.insert(0, r"C:\Users\Sebas\level-player\scripts\Tidal-Media-Downloader\TIDALDL-PY")

import tidal_download_common as tdc
from tidal_dl.download import TIDAL_API, Type
from tidal_dl.events import start

def get_track_id(url_or_id):
    if "spotify:track:" in url_or_id:
        return url_or_id.split("spotify:track:")[-1]
    match = re.search(r"track/([a-zA-Z0-9]+)", url_or_id)
    if match:
        return match.group(1)
    return None

def get_spotify_token(sp_dc):
    url = "https://open.spotify.com/get_access_token?reason=transport&productType=web_player"
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"sp_dc={sp_dc}")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("accessToken")
    except Exception:
        return None

def download_canvas(spotify_url, artist, album, title):
    track_id = get_track_id(spotify_url)
    if not track_id:
        print("[CANVAS] No hay canva (URL no es de Spotify)")
        return

    # Leer sp_dc
    config_path = r"C:\Users\Sebas\level-player\backend\src\config.json"
    sp_dc = None
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                sp_dc = config.get("spotify", {}).get("sp_dc")
        except Exception:
            pass

    if not sp_dc or sp_dc == "TU_SP_DC_COOKIE_AQUI":
        print("[CANVAS] No hay canva (Falta configurar SP_DC en ajustes)")
        return

    token = get_spotify_token(sp_dc)
    if not token:
        print("[CANVAS] No hay canva (SP_DC expirado o invalido)")
        return

    url = "https://spclient.wg.spotify.com/canvas-api/v1/get"
    payload = {"tracks": [{"track_uri": f"spotify:track:{track_id}"}]}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0")

    try:
        with urllib.request.urlopen(req) as response:
            res_json = json.loads(response.read().decode("utf-8"))
            canvases = res_json.get("canvases", [])
            if not canvases:
                print("[CANVAS] No hay canva")
                return
            canvas = canvases[0]
            canvas_url = canvas.get("url")
            canvas_type = canvas.get("type")
            
            if canvas_url:
                # Sanitizar nombres para crear las carpetas
                def sanitize(n):
                    return re.sub(r'[\\/:*?"<>|]', '_', str(n))
                
                album_dir = os.path.join(tdc.DOWNLOAD_PATH, sanitize(artist), sanitize(album))
                os.makedirs(album_dir, exist_ok=True)
                ext = ".mp4" if canvas_type == "VIDEO" else ".jpg"
                out_path = os.path.join(album_dir, f"canvas_{sanitize(title)}{ext}")
                
                req_dl = urllib.request.Request(canvas_url)
                req_dl.add_header("User-Agent", "Mozilla/5.0")
                with urllib.request.urlopen(req_dl) as dl_res, open(out_path, "wb") as f:
                    f.write(dl_res.read())
                print(f"[CANVAS] Canva descargado en {out_path}")
            else:
                print("[CANVAS] No hay canva")
    except Exception as e:
        print(f"[CANVAS] No hay canva (Error API: {e})")

def search_tidal_track(title, artist, isrc):
    if isrc:
        try:
            result = TIDAL_API.__get__('tracks', {'isrc': isrc})
            items = result.get('items', [])
            if items:
                return items[0]['id']
        except Exception as e:
            print(f"Error searching ISRC: {e}")

    q = f"{title} {artist}"
    try:
        result = TIDAL_API.search(q, Type.Track)
        tracks = result.tracks.items
        if tracks:
            return tracks[0].id
    except Exception as e:
        print(f"Error searching text: {e}")
    return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="URL of the track (Spotify or Tidal)")
    parser.add_argument("--isrc", help="ISRC code")
    parser.add_argument("--title", help="Track title")
    parser.add_argument("--artist", help="Track artist")
    parser.add_argument("--album", help="Track album", default="")
    args = parser.parse_args()

    if not tdc.login_tidal():
        sys.exit(1)
    
    tdc.apply_download_settings()

    # Descargar canva si es un link de spotify
    if args.url and "spotify.com" in args.url:
        download_canvas(args.url, args.artist, args.album, args.title)

    if args.url and "tidal.com" in args.url:
        print(f"[*] Downloading Tidal direct URL: {args.url}")
        start(args.url)
        sys.exit(0)

    print(f"[*] Searching Tidal for: {args.title} - {args.artist} (ISRC: {args.isrc})")
    track_id = search_tidal_track(args.title, args.artist, args.isrc)
    
    if not track_id:
        print("[!] Track not found on Tidal.")
        sys.exit(1)

    print(f"[*] Found Tidal Track ID: {track_id}. Downloading...")
    try:
        start(f"https://tidal.com/track/{track_id}")
        print("[OK] Download complete.")
    except Exception as e:
        print(f"[FAIL] Download failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
