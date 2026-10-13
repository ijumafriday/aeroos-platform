import os
import time
import urllib.parse
import urllib.request
import json

_TOKEN: tuple[str, float] | None = None

def service_token() -> str:
    global _TOKEN
    now = time.time()
    if _TOKEN and _TOKEN[1] - 30 > now:
        return _TOKEN[0]
    url = os.environ.get('OIDC_TOKEN_URL', 'http://localhost:8081/realms/aeroos/protocol/openid-connect/token')
    client_id = os.environ.get('SERVICE_CLIENT_ID', 'aeroos-optimiser')
    secret = os.environ.get('SERVICE_CLIENT_SECRET', 'dev-aeroos-optimiser-secret-change-me')
    body = urllib.parse.urlencode({'grant_type':'client_credentials','client_id':client_id,'client_secret':secret}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type':'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode())
    token = payload.get('access_token')
    if not token:
        raise RuntimeError('Service authentication returned no access_token')
    _TOKEN = (token, now + max(60, int(payload.get('expires_in', 300))))
    return token
