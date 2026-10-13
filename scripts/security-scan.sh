#!/usr/bin/env bash
# Security scan before a penetration test (docs/certification/pentest-scope.md). Runs in Docker, installs nothing:
#   1. OWASP ZAP baseline (passive) scan of the web app and API on the running stack;
#   2. dependency audit of the production dependencies (pnpm audit, high and critical);
#   3. response headers of the app, the runtime config and the API.
#   scripts/security-scan.sh          (stack must be up)  → security-report/ (send security-report/summary.txt)
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
ROOT="$(pwd)"; OUT="$ROOT/security-report"; mkdir -p "$OUT"; chmod 777 "$OUT" 2>/dev/null || true
WEB="${AEROOS_URL:-http://localhost:8080}"
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(docker compose ps -q web 2>/dev/null)" 2>/dev/null | awk '{print $1}')"
SUMMARY="$OUT/summary.txt"; : > "$SUMMARY"
say() { echo "$*" | tee -a "$SUMMARY"; }
say "AeroOS security scan — $(date -u +%FT%TZ)"

say ""; say "1. OWASP ZAP baseline (passive)"
if [ -z "$NET" ]; then say "   SKIPPED: the stack is not running (docker compose up -d)"; else
  docker run --rm --network "$NET" -v "$OUT:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py -t http://web:8080 -r zap-baseline.html -J zap-baseline.json -I -m 3 > "$OUT/zap.log" 2>&1
  say "   $(grep -E '^FAIL-NEW|^WARN-NEW|^PASS' "$OUT/zap.log" | tail -1 || echo 'see zap.log')"
  grep -E '^(FAIL|WARN)-NEW' "$OUT/zap.log" | sed 's/^/   /' | tee -a "$SUMMARY" >/dev/null || true
  say "   report: security-report/zap-baseline.html"
fi

say ""; say "2. Dependency audit (production, high and critical)"
if [ -f pnpm-lock.yaml ]; then
  docker run --rm -v "$ROOT:/src:ro" node:22-bookworm-slim bash -c '
    mkdir -p /w && cd /src && tar --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -C /w -xf - && cd /w
    corepack enable >/dev/null 2>&1; pnpm audit --prod --audit-level high' > "$OUT/audit.txt" 2>&1
  RC=$?; say "   $( [ $RC = 0 ] && echo 'no high or critical advisories' || echo "advisories found (exit $RC) — see security-report/audit.txt")"
else say "   FAILED: pnpm-lock.yaml missing — dependency audit cannot be trusted"; exit 2; fi

say ""; say "3. Response headers"
for path in / /runtime-config.json /api/health; do
  H="$(curl -s -D - -o /dev/null --max-time 10 "$WEB$path" | tr -d '\r')"
  miss=""
  for h in x-content-type-options x-frame-options referrer-policy permissions-policy; do
    echo "$H" | grep -qi "^$h:" || miss="$miss $h"
  done
  if echo "$H" | grep -qi '^content-security-policy:'; then csp="CSP enforcing"
  elif echo "$H" | grep -qi '^content-security-policy-report-only:'; then csp="CSP report-only (not enforced yet)"
  else csp="no CSP"; fi
  say "   $path: $([ -z "$miss" ] && echo ok || echo "missing:$miss") · $csp"
done
echo
echo "Done — send security-report/summary.txt (and zap-baseline.html for details)."
