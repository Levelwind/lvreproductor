import configparser
import os

config_path = r'C:\Users\Sebas\AppData\Roaming\qobuz-dl\config.ini'
if os.path.exists(config_path):
    c = configparser.ConfigParser()
    c.read(config_path)
    c['DEFAULT']['password'] = '5181d680967c248fd9b9dbb49de80e7f'
    with open(config_path, 'w') as out:
        c.write(out)
    print("Updated config successfully.")
else:
    print("Config file not found.")
