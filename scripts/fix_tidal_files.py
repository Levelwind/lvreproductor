import os
import subprocess
import sys

def fix_files(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(".flac"):
                path = os.path.join(root, file)
                try:
                    # Check if it's already a valid FLAC
                    with open(path, 'rb') as f:
                        header = f.read(4)
                        if header == b'fLaC':
                            continue
                    
                    # Check if it's an MP4 container
                    with open(path, 'rb') as f:
                        f.seek(4)
                        magic = f.read(8)
                        if b'ftypiso8' not in magic and b'ftypdash' not in magic and b'ftypmp4' not in magic:
                            continue

                    print(f"[*] Fixing: {file}")
                    temp_path = path + ".tmp.flac"
                    
                    cmd = ['ffmpeg', '-y', '-i', path, '-c', 'copy', temp_path]
                    result = subprocess.run(cmd, capture_output=True, text=True)
                    
                    if result.returncode == 0:
                        os.remove(path)
                        os.rename(temp_path, path)
                        print(f"[OK] Fixed: {file}")
                    else:
                        print(f"[ERR] Failed to fix {file}")
                        if os.path.exists(temp_path):
                            os.remove(temp_path)
                            
                except Exception as e:
                    print(f"[!] Error processing {file}: {e}")

if __name__ == "__main__":
    # Fix everything in the main download folder
    fix_files(r"c:\Users\Sebas\Music\Alta y Media Calidad")
