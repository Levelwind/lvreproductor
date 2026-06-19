import requests
import hashlib

email = "YOUR_EMAIL@example.com"
password = "YOUR_PASSWORD"
pwd_md5 = hashlib.md5(password.encode("utf-8")).hexdigest()
app_id = "798273057"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
    "X-App-Id": app_id,
})

base = "https://www.qobuz.com/api.json/0.2/"

# Try GET with plain password
print("=== Test 1: GET + plain password ===")
try:
    r = session.get(base + "user/login", params={"email": email, "password": password, "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
except Exception as e:
    print(f"Error: {e}")

# Try GET with MD5 password
print("\n=== Test 2: GET + MD5 password ===")
try:
    r = session.get(base + "user/login", params={"email": email, "password": pwd_md5, "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
except Exception as e:
    print(f"Error: {e}")

# Try POST with plain password
print("\n=== Test 3: POST + plain password ===")
try:
    r = session.post(base + "user/login", data={"email": email, "password": password, "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
except Exception as e:
    print(f"Error: {e}")

# Try POST with MD5 password
print("\n=== Test 4: POST + MD5 password ===")
try:
    r = session.post(base + "user/login", data={"email": email, "password": pwd_md5, "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
except Exception as e:
    print(f"Error: {e}")

# Try POST JSON with plain password
print("\n=== Test 5: POST JSON + plain password ===")
try:
    r = session.post(base + "user/login", json={"email": email, "password": password, "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:300]}")
except Exception as e:
    print(f"Error: {e}")
