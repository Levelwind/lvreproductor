import os
import subprocess

# List of albums and their tracks
discography = {
    "Mulatos & Mestizos - Todos Los Juguetes": [
        "Pate Perro", "De Ruana", "500BPM", "Cada $entavo", "Sol De Agua", "Chimbiar La Calle", "Agua De Sol (Reblujado)"
    ],
    "The Rap Game, Vol. 1": [
        "Por Ay", "Nazario", "Tiempo Contao", "Raperitos de Domingo", "Killa Bizz", "Valió La Pena", "I Gotta Go", "Air Paris", "A La Carrera", "Oro Fundido", "Campanas"
    ],
    "No Me Acuerdo": [
        "INTRO", "No Me Acuerdo", "BluessyShit", "BUMBÁ", "Combo (MIH)", "NO SIGNAL", "pausa pa fumar", "MIFAI", "Mierda En Mis Bapestas", "provlemas", "LOWKEYPERCHO", "Bello", "All Right", "Voz A Voz", "R4PSTAR", "bonu$"
    ],
    "LO-POCALYPSE LOOPS": [
        "Intro (Bestiario)", "Anarquía en Medellín", "Wacky", "Bastian Laurent", "Stop", "Interludio (Habláme)", "No me soya la playa", "LoveIsInTheAir", "Eso Está Muy Jazzudo", "Chaíto", "Outro (Suerte)"
    ]
}

# Singles that are NOT in albums
singles = [
    "Low Cost", "Sin corte", "Lágrimas De Chango", "Momento", "Emproblemao", 
    "Pa' Donde Te Quieran", "Pararrayo", "RIVERPLATE", "Karate", "Cero Estrés", 
    "4EVA", "Summer Nights", "Envigado 1.0", "Dembow de Caldas", "Tabaquito", "Lanzallamas", "SUERTE"
]

artist = "Oblivion's Mighty Trash" # As identified by subagent
output_root = r"c:\Users\Sebas\Music\Buhodermia"

def download_song(song_name, album_name):
    album_dir = os.path.join(output_root, album_name)
    if not os.path.exists(album_dir):
        os.makedirs(album_dir)
    
    print(f"Downloading: {song_name} from {album_name}")
    query = f"ytsearch1:\"{song_name}\" \"{artist}\" \"{album_name}\""
    
    cmd = [
        "yt-dlp",
        "--extract-audio",
        "--audio-format", "m4a",
        "--audio-quality", "0", # best
        "--add-metadata",
        "--embed-thumbnail",
        "--output", os.path.join(album_dir, f"%(title)s.%(ext)s"),
        query
    ]
    
    subprocess.run(cmd)

# Download Albums
for album, tracks in discography.items():
    for track in tracks:
        download_song(track, album)

# Download Singles
for single in singles:
    download_song(single, "Singles")

print("Download complete.")
