import logging
import hashlib
import configparser
import os
from qobuz_dl.bundle import Bundle

logging.basicConfig(level=logging.DEBUG)

print("Getting tokens from Qobuz...")
try:
    bundle = Bundle()
    app_id = str(bundle.get_app_id())
    secrets = ",".join(bundle.get_secrets().values())
    print(f"App ID: {app_id}")
    print(f"Secrets: {secrets}")
    
    # Create the config
    config = configparser.ConfigParser()
    config["DEFAULT"]["email"] = "YOUR_EMAIL@example.com"
    config["DEFAULT"]["password"] = hashlib.md5(b"YOUR_PASSWORD").hexdigest()
    config["DEFAULT"]["default_folder"] = "Qobuz Downloads"
    config["DEFAULT"]["default_quality"] = "27"
    config["DEFAULT"]["default_limit"] = "20"
    config["DEFAULT"]["no_m3u"] = "false"
    config["DEFAULT"]["albums_only"] = "false"
    config["DEFAULT"]["no_fallback"] = "false"
    config["DEFAULT"]["og_cover"] = "false"
    config["DEFAULT"]["embed_art"] = "false"
    config["DEFAULT"]["no_cover"] = "false"
    config["DEFAULT"]["no_database"] = "false"
    config["DEFAULT"]["app_id"] = app_id
    config["DEFAULT"]["secrets"] = secrets
    config["DEFAULT"]["folder_format"] = "{artist} - {album} ({year}) [{bit_depth}B-{sampling_rate}kHz]"
    config["DEFAULT"]["track_format"] = "{tracknumber}. {tracktitle}"
    config["DEFAULT"]["smart_discography"] = "false"
    
    config_path = os.path.join(os.environ.get("APPDATA"), "qobuz-dl", "config.ini")
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, "w") as f:
        config.write(f)
    print(f"\nConfig file written to: {config_path}")
    print("Done!")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
