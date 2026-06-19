import requests
import hashlib
import time
import json
import os
from mutagen.flac import FLAC

app_id = "798273057"
user_auth_token = "6gSpnQbAZtGlG8ETgTqxViiJ-1TpLmhEGCeowgXtNIGL6a3Z8rqhM1aA6JHVjkcD2Tf0uQ6pPBJY80ZFw-QCSg"
secrets = ["806331c3b0b641da923b890aed01d04a", "f69a7734686cb9427629378a4b7ac381", "abb21364945c0583309667d13ca3d93a"]

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
    "X-App-Id": app_id,
    "X-User-Auth-Token": user_auth_token,
})

track_id = "288966081"

# 1. Get track info
print("Getting track info...")
r = session.get("https://www.qobuz.com/api.json/0.2/track/get", params={"track_id": track_id}, timeout=30)
r.raise_for_status()
track_data = r.json()

artist = track_data.get("performer", {}).get("name", "Unknown")
title = track_data.get("title", "Unknown")
album_title = track_data.get("album", {}).get("title", "Unknown")
track_number = track_data.get("track_number", 0)
print(f"Track: {artist} - {title}")
print(f"Album: {album_title}")

# 2. Get file URL (try each secret)
print("\nGetting download URL...")
file_url = None
file_data = None
for fmt_id in ["27", "7", "6", "5"]:  # Try highest quality first
    for secret in secrets:
        unix = time.time()
        r_sig = f"trackgetFileUrlformat_id{fmt_id}intentstreamtrack_id{track_id}{unix}{secret}"
        r_sig_hashed = hashlib.md5(r_sig.encode("utf-8")).hexdigest()
        
        try:
            r = session.get("https://www.qobuz.com/api.json/0.2/track/getFileUrl", params={
                "request_ts": unix,
                "request_sig": r_sig_hashed,
                "track_id": track_id,
                "format_id": fmt_id,
                "intent": "stream",
            }, timeout=30)
            
            if r.status_code == 200:
                file_data = r.json()
                file_url = file_data.get("url")
                if file_url:
                    print(f"Quality: format_id={fmt_id}, bit_depth={file_data.get('bit_depth')}, sample_rate={file_data.get('sampling_rate')}kHz")
                    print(f"Mime: {file_data.get('mime_type')}")
                    break
            else:
                print(f"  fmt={fmt_id} secret={secret[:8]}... -> {r.status_code}")
        except Exception as e:
            print(f"  fmt={fmt_id} secret={secret[:8]}... -> Error: {e}")
    if file_url:
        break

if not file_url:
    print("ERROR: Could not get download URL")
    exit(1)

# 3. Download the file
DOWNLOAD_PATH = r"c:\Users\Sebas\Music\Alta y Media Calidad"
ext = "flac" if "flac" in file_data.get("mime_type", "") else "mp3"

# Sanitize names for path construction
def sanitize_name(name):
    for ch in ['<', '>', ':', '"', '/', '\\', '|', '?', '*']:
        name = name.replace(ch, '_')
    return name.strip()

sanitized_artist = sanitize_name(artist)
sanitized_album = sanitize_name(album_title)
sanitized_title = sanitize_name(title)

dest_dir = os.path.join(DOWNLOAD_PATH, sanitized_artist, sanitized_album)
os.makedirs(dest_dir, exist_ok=True)

filename = f"{sanitized_artist} - {sanitized_title}.{ext}"
filepath = os.path.join(dest_dir, filename)

print(f"\nDownloading to: {filepath}")
dl = requests.get(file_url, stream=True, timeout=30)
dl.raise_for_status()
total = int(dl.headers.get('content-length', 0))
downloaded = 0
with open(filepath, "wb") as f:
    for chunk in dl.iter_content(chunk_size=32768):
        f.write(chunk)
        downloaded += len(chunk)
        if total > 0:
            pct = (downloaded / total) * 100
            print(f"\r  {downloaded}/{total} bytes ({pct:.1f}%)", end="", flush=True)

print(f"\n\nDownloaded successfully! ({downloaded} bytes)")

# 4. Download cover art
cover_url = track_data.get("album", {}).get("image", {}).get("large")
cover_data = None
if cover_url:
    print("Downloading cover art...")
    try:
        cr = requests.get(cover_url, timeout=15)
        cr.raise_for_status()
        cover_data = cr.content
        print(f"  Cover: {len(cover_data)} bytes")
    except:
        print("  Cover download failed")

# 5. Tag the file
if ext == "flac":
    print("Tagging FLAC file...")
    try:
        audio = FLAC(filepath)
        audio["title"] = title
        audio["artist"] = artist
        audio["album"] = album_title
        audio["tracknumber"] = str(track_number)
        if cover_data:
            from mutagen.flac import Picture
            pic = Picture()
            pic.type = 3  # Cover front
            pic.mime = "image/jpeg"
            pic.data = cover_data
            audio.add_picture(pic)
        audio.save()
        print("  Tags saved!")
    except Exception as e:
        print(f"  Tagging error: {e}")

print(f"\nDone! File saved as: {filepath}")
