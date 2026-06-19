#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""Configuración compartida: audio + letras (.lrc) en cada descarga Tidal."""

import os
import sys
import time

# Asegurar que usamos el tidal_dl del proyecto (con parches de letras)
sys.path.insert(0, r"c:\Users\Sebas\Music\scripts\Tidal-Media-Downloader\TIDALDL-PY")

from tidal_dl.download import *
from tidal_dl.paths import getProfilePath, getTokenPath

DOWNLOAD_PATH = r"c:\Users\Sebas\Music\Alta y Media Calidad"


import json
import base64

def login_tidal():
    """Inicia sesión con token guardado en config.json. Devuelve True si OK."""
    config_path = r"C:\Users\Sebas\level-player\backend\src\config.json"
    token = None
    userid = None

    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                token = config.get("tidal", {}).get("token")
                
                if token:
                    # Extraer userid del token JWT
                    payload = token.split('.')[1]
                    payload += '=' * (-len(payload) % 4)
                    decoded = base64.urlsafe_b64decode(payload).decode('utf-8')
                    userid = json.loads(decoded).get('uid')
    except Exception as e:
        print(f"[ERROR] Falló al leer config.json: {e}")

    # Siempre inicializamos SETTINGS y TOKEN
    SETTINGS.read(getProfilePath())
    TOKEN.read(getTokenPath())

    # Sobrescribimos el token y userid si estaban en config.json
    if token and userid:
        TOKEN.accessToken = token
        TOKEN.userid = userid
    else:
        # Si no había en config.json, usamos el de tidal-dl local
        token = TOKEN.accessToken
        userid = TOKEN.userid

    if not token:
        print("[ERROR] No hay token Tidal. Verifica la configuración en la UI o ejecuta login.")
        return False

    SETTINGS.apiKeyIndex = 4
    TIDAL_API.apiKey = apiKey.getItem(SETTINGS.apiKeyIndex)

    try:
        TIDAL_API.loginByAccessToken(token, userid)
        print(f"[OK] Sesión Tidal activa ({TIDAL_API.key.countryCode})")
        # Actualizamos el token en la memoria de tidal-dl
        TOKEN.accessToken = token
        TOKEN.userid = userid
        return True
    except Exception as e:
        print(f"[ERROR] No se pudo iniciar sesión: {e}")
        print("        Renueva el token en la interfaz de configuración.")
        return False


def apply_download_settings(include_ep=False):
    """Audio Max/FLAC + carpeta organizada + letras .lrc automáticas."""
    SETTINGS.audioQuality = AudioQuality.Max
    SETTINGS.downloadPath = DOWNLOAD_PATH
    SETTINGS.checkExist = True
    SETTINGS.saveCovers = True
    SETTINGS.showProgress = True
    SETTINGS.lyricFile = True
    SETTINGS.trackFileFormat = R"{ArtistName} - {TrackTitle}"
    SETTINGS.albumFolderFormat = R"{ArtistName}/{AlbumTitle}"
    SETTINGS.downloadDelay = True
    if include_ep:
        SETTINGS.includeEP = True
    SETTINGS.save()
    os.makedirs(DOWNLOAD_PATH, exist_ok=True)
    print("[*] Modo: audio FLAC Max + letras .lrc en cada pista")
