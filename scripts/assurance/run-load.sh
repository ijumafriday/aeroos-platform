#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ACCESS_TOKEN:?ACCESS_TOKEN is required}"
command -v k6 >/dev/null || { echo 'k6 is required' >&2; exit 2; }
PROFILE="${1:-major-airline}"
OUT="${ASSURANCE_OUT:-assurance-results/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
case "$PROFILE" in
  major-airline) script=tests/load/major-airline.k6.js ;;
  soak) script=tests/load/soak.k6.js ;;
  *) echo 'usage: run-load.sh {major-airline|soak}' >&2; exit 2;;
esac
k6 run --summary-export "$OUT/${PROFILE}-summary.json" "$script" | tee "$OUT/${PROFILE}.log"
printf '{"profile":"%s","completedAt":"%s","gitCommit":"%s"}\n' "$PROFILE" "$(date -u +%FT%TZ)" "$(git rev-parse HEAD 2>/dev/null || echo unavailable)" > "$OUT/run.json"
echo "PASS evidence=$OUT"
