import requests

# Use cookies from the browser session
session = requests.Session()
app_id = "798273057"

session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
    "X-App-Id": app_id,
})

# Set cookies from browser
session.cookies.set("userCookie", "YOUR_USER_ID", domain=".qobuz.com")
session.cookies.set("wzup", "exuid=YOUR_USER_ID", domain=".qobuz.com")
session.cookies.set("wzsite", "CO", domain=".qobuz.com")

# Try to get user info using cookies as auth
print("=== Test: API call with browser cookies ===")
try:
    r = session.get("https://www.qobuz.com/api.json/0.2/user/get", params={"user_id": "YOUR_USER_ID"})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
except Exception as e:
    print(f"Error: {e}")

# Try the web login endpoint used by the player (OAuth-style)
print("\n=== Test: Web login endpoint ===")
try:
    r = session.post("https://www.qobuz.com/api.json/0.2/user/login",
        data={"email": "YOUR_EMAIL@example.com", "password": "YOUR_PASSWORD", "app_id": app_id})
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
except Exception as e:
    print(f"Error: {e}")

# Try getting an OAuth token via the web player's actual login flow
print("\n=== Test: OAuth signin flow ===")
try:
    r = session.get("https://www.qobuz.com/signin/oauth", 
        params={"client_id": app_id, "redirect_uri": "https://play.qobuz.com/login"})
    print(f"Status: {r.status_code}")
    print(f"URL: {r.url}")
    if "token" in r.text.lower() or "auth" in r.text.lower():
        # Find token in response
        import re
        tokens = re.findall(r'["\']?(?:token|auth)["\']?\s*[:=]\s*["\']([^"\']+)["\']', r.text, re.I)
        print(f"Tokens found: {tokens}")
except Exception as e:
    print(f"Error: {e}")
