#!/usr/bin/env bash
set -euo pipefail
# Non-destructive Docker Compose dependency-loss drill. Stops one dependency, proves API liveness remains
# healthy while readiness fails, restores it, then measures readiness recovery. No database volume is removed.
cd "$(dirname "$0")/../.."
SERVICE="${1:-postgres}"
RTO="${RTO_SECONDS:-120}"
BASE_URL="${BASE_URL:-http://localhost:8080}"
case "$SERVICE" in postgres|temporal|minio) ;; *) echo 'usage: failure-drill.sh {postgres|temporal|minio}' >&2; exit 2;; esac
cleanup(){ docker compose start "$SERVICE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
curl -fsS "$BASE_URL/api/health/ready" >/dev/null || { echo 'FAIL stack not ready before drill'; exit 1; }
docker compose stop "$SERVICE" >/dev/null
for _ in $(seq 1 30); do
  live=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/health/live" || true)
  ready=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/health/ready" || true)
  if [ "$live" = 200 ] && [ "$ready" = 503 ]; then break; fi
  sleep 1
done
[ "${live:-}" = 200 ] && [ "${ready:-}" = 503 ] || { echo "FAIL expected live=200 ready=503, got live=$live ready=$ready"; exit 1; }
start=$(date +%s)
docker compose start "$SERVICE" >/dev/null
while :; do
  if curl -fsS "$BASE_URL/api/health/ready" >/dev/null 2>&1; then break; fi
  now=$(date +%s); [ $((now-start)) -lt "$RTO" ] || { echo "FAIL $SERVICE readiness recovery exceeded ${RTO}s"; exit 1; }
  sleep 2
done
elapsed=$(( $(date +%s)-start ))
trap - EXIT
echo "PASS dependency=$SERVICE liveness_preserved=true readiness_failed_closed=true recovery_seconds=$elapsed target_seconds=$RTO"
