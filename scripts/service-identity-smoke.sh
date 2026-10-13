#!/usr/bin/env bash
set -euo pipefail
: "${OIDC_TOKEN_URL:?OIDC_TOKEN_URL required}"
: "${SERVICE_CLIENT_ID:?SERVICE_CLIENT_ID required}"
: "${SERVICE_CLIENT_SECRET:?SERVICE_CLIENT_SECRET required}"
: "${API_URL:?API_URL required}"
TOKEN="$(curl -fsS -X POST "$OIDC_TOKEN_URL" -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=client_credentials --data-urlencode client_id="$SERVICE_CLIENT_ID" \
  --data-urlencode client_secret="$SERVICE_CLIENT_SECRET" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
[ -n "$TOKEN" ]
# Exercise a guarded, side-effect-free identity probe.
curl -fsS "$API_URL/api/internal/platform/identity" -H "authorization: Bearer $TOKEN" | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("trusted") is True'
echo 'PASS service workload identity'
