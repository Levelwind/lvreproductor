#!/usr/bin/env python
# -*- encoding: utf-8 -*-
"""
Descarga masiva de ARTISTAS desde Tidal.
Incluye audio (FLAC) + letras (.lrc) en cada pista.
"""

import os
import sys
import time

sys.path.insert(0, r"c:\Users\Sebas\Music\scripts")

import tidal_download_common as tdc
from tidal_dl.events import start

LINKS_FILE = r"c:\Users\Sebas\Music\scripts\links_artistas.txt"
FAILED_LINKS_FILE = r"c:\Users\Sebas\Music\scripts\fallos_artistas.txt"
MAX_RETRIES = 5
DELAY_BETWEEN = 2


def download_with_retry(url, max_retries=MAX_RETRIES):
    for attempt in range(1, max_retries + 1):
        try:
            start(url)
            return "OK"
        except Exception as e:
            error_msg = str(e)
            if attempt < max_retries:
                wait_times = [15, 30, 60, 120, 300]
                wait = wait_times[attempt - 1] if attempt - 1 < len(wait_times) else 300
                print(f"    [RETRY] Intento {attempt}/{max_retries} falló: {error_msg}")
                print(f"    [RETRY] Reintentando en {wait}s...")
                time.sleep(wait)
            else:
                print(f"    [FAIL] Agotados {max_retries} intentos: {error_msg}")
                return error_msg
    return "Unknown error"


def read_links():
    if not os.path.exists(LINKS_FILE):
        print(f"[!] No se encontró el archivo '{LINKS_FILE}'.")
        return []
    with open(LINKS_FILE, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    return [line[:-2] if line.endswith("/u") else line for line in lines]


def write_failed_links(failed_urls):
    if not failed_urls:
        return
    with open(FAILED_LINKS_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n# Fallos del {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        for url in failed_urls:
            f.write(url + "\n")


def main():
    tracks = read_links()
    if not tracks:
        print("[!] No hay artistas listados para descargar. Saliendo.")
        return

    print("[*] Iniciando sesión...")
    if not tdc.login_tidal():
        return

    tdc.apply_download_settings(include_ep=True)

    results = []
    total = len(tracks)

    for i, url in enumerate(tracks, 1):
        print(f"\n{'='*60}")
        print(f"[{i}/{total}] Procesando Artista: {url}")
        print(f"{'='*60}")
        status = download_with_retry(url)
        results.append((url, status))
        if i < total:
            time.sleep(DELAY_BETWEEN)

    ok = [r for r in results if r[1] == "OK"]
    failed = [r for r in results if r[1] != "OK"]

    print(f"\n{'='*60}")
    print("  REPORTE FINAL DE ARTISTAS")
    print(f"{'='*60}")
    print(f"  Total procesados: {total}")
    print(f"  Exitosos:         {len(ok)}")
    print(f"  Fallidos:         {len(failed)}")

    if failed:
        print(f"\n  --- Artistas fallidos ---")
        write_failed_links([url for url, _ in failed])
        for url, _ in failed:
            print(f"  x {url}")

    with open(LINKS_FILE, "w", encoding="utf-8") as f:
        f.write("# Pega aquí los enlaces de ARTISTAS de Tidal (uno por línea).\n")
        f.write("# Ejemplo: https://tidal.com/artist/3588235\n")

    print(f"{'='*60}\n[FIN]")


if __name__ == "__main__":
    main()
