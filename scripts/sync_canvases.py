import sys
import json
import urllib.request
import urllib.parse
import urllib.error
import re
import os
import time

# Reconfigurar la salida estándar a UTF-8 para evitar errores de codificación en consolas de Windows (como cp1252)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def get_spotify_token(sp_dc):
    url = "https://open.spotify.com/"
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"sp_dc={sp_dc}")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode("utf-8")
            match = re.search(r'"accessToken":"(.*?)"', html)
            if match:
                return match.group(1)
            else:
                print("Token not found in HTML.")
                return None
    except Exception as e:
        print(f"[!] Error getting access token from HTML: {e}")
        return None

def search_track_yahoo(title, artist):
    t = re.sub(r'\.(mp3|flac|wav)$', '', title, flags=re.IGNORECASE)
    t = re.sub(r'\[.*?\]', '', t)
    t = re.sub(r'\(official video\)|\(with lyrics\)|\(lyrics\)|\(audio\)|\(music video\)', '', t, flags=re.IGNORECASE)
    t = re.sub(r'-+', ' ', t)
    
    query = t.strip()
    if artist and artist != 'Artista Desconocido':
        query = f"{artist} {query}"
    query = f"{query} spotify track"
    query_encoded = urllib.parse.quote(query)
    url = f"https://search.yahoo.com/search?p={query_encoded}"
    
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode("utf-8")
            patterns = [
                r'spotify\.com/track/([a-zA-Z0-9]{22})',
                r'spotify\.com%2ftrack%2f([a-zA-Z0-9]{22})',
                r'spotify%3atrack%3a([a-zA-Z0-9]{22})',
                r'spotify:track:([a-zA-Z0-9]{22})'
            ]
            for pattern in patterns:
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
            patterns_fallback = [
                r'spotify\.com/track/([a-zA-Z0-9]+)',
                r'spotify\.com%2ftrack%2f([a-zA-Z0-9]+)'
            ]
            for pattern in patterns_fallback:
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
    except Exception as e:
        print(f"  -> Error al buscar en Yahoo: {e}")
    return None

def search_track(token, title, artist):
    t = re.sub(r'\.(mp3|flac|wav)$', '', title, flags=re.IGNORECASE)
    t = re.sub(r'\[.*?\]', '', t)
    t = re.sub(r'\(official video\)|\(with lyrics\)|\(lyrics\)|\(audio\)|\(music video\)', '', t, flags=re.IGNORECASE)
    t = re.sub(r'-+', ' ', t)
    
    query = t.strip()
    if artist and artist != 'Artista Desconocido':
        query += f" {artist}"
        
    query_encoded = urllib.parse.quote(query)
    url = f"https://api.spotify.com/v1/search?q={query_encoded}&type=track&limit=1"
    
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as response:
            res_json = json.loads(response.read().decode("utf-8"))
            items = res_json.get("tracks", {}).get("items", [])
            if items:
                return items[0].get("id")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = int(e.headers.get("Retry-After", 5))
            if retry_after > 10:
                print(f"\n[!] Spotify API Rate Limited por {retry_after}s. Saltando a búsqueda en Yahoo...")
                return search_track_yahoo(title, artist)
            else:
                print(f"\n[!] Spotify API Rate Limited (429). Esperando {retry_after} segundos para reintentar...")
                time.sleep(retry_after)
                return search_track(token, title, artist)
        else:
            print(f"\n[!] Error HTTP {e.code} al buscar: {e.reason}")
    except Exception as e:
        pass
    return search_track_yahoo(title, artist)

def download_canvas(token, track_id, out_dir, filename_base):
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
                return False, "No canvas found on Spotify for this track."
            
            canvas = canvases[0]
            canvas_url = canvas.get("url")
            canvas_type = canvas.get("type")
            
            if canvas_url:
                ext = ".mp4" if canvas_type == "VIDEO" else ".jpg"
                out_path = os.path.join(out_dir, f"{filename_base}.canvas{ext}")
                
                if os.path.exists(out_path):
                    return True, "Already exists."

                req_dl = urllib.request.Request(canvas_url)
                req_dl.add_header("User-Agent", "Mozilla/5.0")
                with urllib.request.urlopen(req_dl) as dl_res, open(out_path, "wb") as f:
                    f.write(dl_res.read())
                return True, f"Saved as {out_path}"
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = int(e.headers.get("Retry-After", 5))
            print(f"\n[!] Spotify Canvas API Rate Limited (429). Esperando {retry_after} segundos para reintentar...")
            time.sleep(retry_after)
            return download_canvas(token, track_id, out_dir, filename_base)
        else:
            return False, f"HTTP Error {e.code}: {e.reason}"
    except Exception as e:
        return False, str(e)
    return False, "Unknown error."

def main():
    config_path = r"C:\Users\Sebas\level-player\backend\src\config.json"
    state_path = r"C:\Users\Sebas\level-player\backend\src\library_state.json"
    
    if not os.path.exists(config_path) or not os.path.exists(state_path):
        print("Cannot find config.json or library_state.json")
        sys.exit(1)
        
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
        
    with open(state_path, "r", encoding="utf-8") as f:
        state = json.load(f)
        
    sp_dc = config.get("spotify", {}).get("sp_dc")
    direct_token = config.get("spotify", {}).get("accessToken")
    
    token = None
    if direct_token and direct_token != "PEGA_AQUI_EL_ACCESSTOKEN":
        token = direct_token
    elif sp_dc and sp_dc != "TU_SP_DC_COOKIE_AQUI":
        token = get_spotify_token(sp_dc)
        
    if not token:
        print("[!] No se pudo obtener el token. Pega tu accessToken en config.json.")
        sys.exit(1)
        
    tracks = state.get("tracks", [])
    print(f"[*] Starting Canvas sync for {len(tracks)} tracks...")
    
    success_count = 0
    fail_count = 0
    skip_count = 0
    
    for i, track in enumerate(tracks):
        title = track.get("title", "")
        artist = track.get("artist", "")
        file_path = track.get("filePath", "")
        
        if not file_path or not os.path.exists(file_path):
            continue
            
        out_dir = os.path.dirname(file_path)
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        
        if os.path.exists(os.path.join(out_dir, f"{base_name}.canvas.mp4")) or \
           os.path.exists(os.path.join(out_dir, f"{base_name}.canvas.jpg")):
            skip_count += 1
            continue
            
        print(f"[{i+1}/{len(tracks)}] Searching: {title} - {artist}")
        track_id = search_track(token, title, artist)
        
        if track_id:
            print(f"  -> Found ID: {track_id}. Fetching canvas...")
            success, msg = download_canvas(token, track_id, out_dir, base_name)
            if success:
                print(f"  -> [OK] {msg}")
                success_count += 1
            else:
                print(f"  -> [NO CANVAS] {msg}")
                fail_count += 1
        else:
            print("  -> [!] Track not found on Spotify.")
            fail_count += 1
            
        print("  -> Waiting 3 seconds (Anti-ban)...")
        time.sleep(3)
        
    print("\n" + "="*40)
    print("SYNC COMPLETE")
    print(f"Downloaded: {success_count}")
    print(f"No Canvas / Failed: {fail_count}")
    print(f"Already had canvas (Skipped): {skip_count}")
    print("="*40)

if __name__ == "__main__":
    main()
