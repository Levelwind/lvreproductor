#!/usr/bin/env python
# -*- encoding: utf-8 -*-
import sys
import argparse
import json
import os
import re

sys.path.insert(0, r"C:\Users\Sebas\level-player\scripts")
sys.path.insert(0, r"C:\Users\Sebas\level-player\scripts\Tidal-Media-Downloader\TIDALDL-PY")

import tidal_download_common as tdc
from tidal_dl.download import TIDAL_API

def get_track_id(url_or_id):
    if "tidal.com" in url_or_id:
        match = re.search(r"track/([a-zA-Z0-9]+)", url_or_id)
        if match:
            return match.group(1)
    return url_or_id

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Tidal URL or Track ID")
    args = parser.parse_args()

    # If login fails, we return an error json so the backend knows
    if not tdc.login_tidal():
        print(json.dumps({"error": "Tidal session expired. Please renew your Tidal token in the Settings tab."}))
        sys.exit(0)

    track_id = get_track_id(args.url)
    try:
        track = TIDAL_API.getTrack(track_id)
        if not track:
            print(json.dumps({"error": "Track not found on Tidal."}))
            sys.exit(0)
            
        album_name = ""
        if hasattr(track, 'album') and track.album:
            album_name = getattr(track.album, 'title', "")
                
        artist_name = "Artista Desconocido"
        if hasattr(track, 'artists') and track.artists:
            artist_name = ", ".join([getattr(a, 'name', '') for a in track.artists if getattr(a, 'name', '')])
        elif hasattr(track, 'artist') and track.artist:
            artist_name = getattr(track.artist, 'name', 'Artista Desconocido')

        metadata = {
            "id": str(getattr(track, 'id', '')),
            "title": getattr(track, 'title', 'Track Desconocido'),
            "artist": artist_name,
            "album": album_name,
            "durationMs": getattr(track, 'duration', 0) * 1000,
            "isrc": getattr(track, 'isrc', ""),
            "url": f"https://tidal.com/track/{getattr(track, 'id', '')}"
        }
        print(json.dumps(metadata))
    except Exception as e:
        print(json.dumps({"error": f"Failed to fetch track from Tidal API: {str(e)}"}))

if __name__ == "__main__":
    main()
