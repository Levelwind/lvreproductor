import os
import subprocess
import shutil

def get_codec(file_path):
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except:
        return None

def convert_to_flac(input_path):
    output_path = os.path.splitext(input_path)[0] + ".flac"
    print(f"[*] Convirtiendo: {os.path.basename(input_path)} -> {os.path.basename(output_path)}")
    
    # -c:a flac: Convertir a FLAC lossless
    # -map_metadata 0: Preservar metadatos (tags, carátulas)
    cmd = ['ffmpeg', '-y', '-i', input_path, '-c:a', 'flac', '-map_metadata', '0', output_path]
    
    try:
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"    [ERR] Error al convertir {input_path}: {e.stderr.decode()}")
        return False

def main():
    base_dir = r"C:\Users\Sebas\Music\Alta y Media Calidad"
    alac_files = []

    print("[*] Buscando archivos ALAC...")
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.lower().endswith(".m4a"):
                full_path = os.path.join(root, file)
                if get_codec(full_path) == "alac":
                    alac_files.append(full_path)

    if not alac_files:
        print("[!] No se encontraron archivos ALAC.")
        return

    print(f"[!] Se encontraron {len(alac_files)} archivos ALAC que Dopamine no puede reproducir.")
    
    success_count = 0
    for file in alac_files:
        if convert_to_flac(file):
            # Opcional: Eliminar el original después de convertir
            try:
                os.remove(file)
                success_count += 1
            except Exception as e:
                print(f"    [!] No se pudo eliminar el original: {e}")
        
    print(f"\n[FIN] Se han convertido {success_count} archivos a FLAC.")
    print("[*] Ahora puedes refrescar tu biblioteca en Dopamine.")

if __name__ == "__main__":
    main()
