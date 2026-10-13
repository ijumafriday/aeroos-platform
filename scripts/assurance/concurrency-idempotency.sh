#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8080}"
: "${ACCESS_TOKEN:?ACCESS_TOKEN is required}"
N="${CONCURRENCY:-20}"
KEY="assurance-$(date +%s)-$$"
DIR="$(mktemp -d)"; trap 'rm -rf "$DIR"' EXIT
headers=(-H "Authorization: Bearer $ACCESS_TOKEN" -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json')
if [ -n "${OPERATOR:-}" ]; then headers+=(-H "x-operator: $OPERATOR"); fi
for i in $(seq 1 "$N"); do
  (curl -sS -o "$DIR/body.$i" -w '%{http_code}' -X POST "${headers[@]}" "$BASE_URL/api/notifications/read-all" > "$DIR/code.$i") &
done
wait
ok=0; conflict=0; bad=0
for f in "$DIR"/code.*; do
  c=$(cat "$f"); case "$c" in 200|201|204) ok=$((ok+1));; 409) conflict=$((conflict+1));; *) bad=$((bad+1));; esac
done
[ "$ok" -ge 1 ] && [ "$bad" -eq 0 ] || { echo "FAIL concurrency: success=$ok conflict=$conflict bad=$bad"; exit 1; }
# Once the first request has committed, an exact replay must return the saved result, not execute again.
replay=$(curl -sS -o "$DIR/replay" -w '%{http_code}' -X POST "${headers[@]}" "$BASE_URL/api/notifications/read-all")
[ "$replay" = 200 ] || [ "$replay" = 201 ] || [ "$replay" = 204 ] || { echo "FAIL replay status $replay"; exit 1; }
echo "PASS idempotency concurrency=$N initial_success=$ok in_flight_conflicts=$conflict replay=$replay key=$KEY"
