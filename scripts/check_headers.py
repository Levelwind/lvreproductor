import os

def check_headers(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(".flac"):
                path = os.path.join(root, file)
                try:
                    with open(path, 'rb') as f:
                        header = f.read(16)
                        print(f"File: {file}")
                        print(f"Header: {header.hex(' ')}")
                        # Check for fLaC magic number (66 4c 61 43)
                        if header.startswith(b'fLaC'):
                            print("Status: VALID FLAC")
                        else:
                            print("Status: INVALID (Not fLaC)")
                except Exception as e:
                    print(f"Error reading {file}: {e}")

check_headers(r"c:\Users\Sebas\Music\Alta y Media Calidad\Pantera")
check_headers(r"c:\Users\Sebas\Music\Alta y Media Calidad\Vacations")
