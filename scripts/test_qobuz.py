import logging
from qobuz_dl.core import QobuzDL
import sys

logging.basicConfig(level=logging.DEBUG)

email = "YOUR_EMAIL@example.com"
password = "YOUR_PASSWORD"

try:
    print("Initializing QobuzDL...")
    qobuz = QobuzDL()
    print("Getting tokens...")
    qobuz.get_tokens()
    print(f"App ID: {qobuz.app_id}")
    print("Authenticating...")
    qobuz.initialize_client(email, password, qobuz.app_id, qobuz.secrets)
    print("Success!")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
