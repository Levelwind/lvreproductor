import requests
import hashlib

email = "YOUR_EMAIL@example.com"
password = "YOUR_PASSWORD"
password_md5 = hashlib.md5(password.encode()).hexdigest()

app_id = "100000000" # fallback or actual app id
base = "https://www.qobuz.com/api.json/0.2/"

def test_login(pwd):
    print(f"Testing password: {pwd}")
    # Get a real app_id from qobuz_dl
    from qobuz_dl.core import QobuzDL
    q = QobuzDL()
    q.get_tokens()
    app_id = q.app_id
    
    params = {
        "email": email,
        "password": pwd,
        "app_id": app_id,
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
        "X-App-Id": app_id,
    }
    r = requests.get(base + "user/login", params=params, headers=headers)
    print(f"Status Code: {r.status_code}")
    print(f"Response: {r.text}")

print("Plain password:")
test_login(password)
print("\nMD5 password:")
test_login(password_md5)
