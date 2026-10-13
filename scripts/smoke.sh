#!/usr/bin/env bash
# AeroOS smoke test: run AFTER `docker compose up --build` reports the stack up. Read-mostly: it creates one
# recovery-optimiser run (never accepted). Prints exactly which piece is not working and the relevant log lines.
#   scripts/smoke.sh            (env: AEROOS_URL=http://localhost:8080 KC=http://localhost:8081 PASSWORD=aeroos)
set -u
cd "$(dirname "$0")/.."
WEB="${AEROOS_URL:-http://localhost:8080}"; KC="${KC:-http://localhost:8081}"; PW="${PASSWORD:-aeroos}"
NKX_KEY="${MOVEMENT_KEY_NKX:-dev-movement-key-nkx-change-me}"
PASS=0; FAIL=0; FAILED=()
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      → %s\n' "$2"; FAIL=$((FAIL+1)); FAILED+=("${3:-}"); }
http() { curl -s -o /tmp/aeroos-smoke.body -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || true; }
body() { cat /tmp/aeroos-smoke.body 2>/dev/null; }
field() { sed -n "s/.*\"$1\":\"\\{0,1\\}\\([^\",}]*\\).*/\\1/p" | head -1; }

echo "AeroOS smoke test — $WEB — $(date -u +%FT%TZ)"

echo "1. Containers"
for s in postgres kafka temporal keycloak cerbos minio openbao api worker optimiser web; do
  st="$(docker compose ps --format '{{.State}} {{.Health}}' "$s" 2>/dev/null | head -1)"
  case "$st" in
    running*unhealthy*) bad "$s is running but unhealthy" "docker compose logs --tail 80 $s" "$s";;
    running*) ok "$s ${st}";;
    "") bad "$s is not running" "docker compose up -d $s; then docker compose logs --tail 80 $s" "$s";;
    *) bad "$s: $st" "docker compose logs --tail 80 $s" "$s";;
  esac
done
for s in db-roles openbao-init; do
  st="$(docker compose ps -a --format '{{.State}} {{.ExitCode}}' "$s" 2>/dev/null | head -1)"
  case "$st" in exited\ 0) ok "$s completed";; "") ok "$s (not present)";; *) bad "$s: $st" "docker compose logs $s" "$s";; esac
done

echo "2. Endpoints"
c=$(http "$WEB/"); [ "$c" = 200 ] && ok "web $WEB" || bad "web answered $c" "docker compose logs --tail 50 web" web
c=$(http "$WEB/api/health")
if [ "$c" = 200 ]; then
  h="$(body)"; ok "API health: $h"
  v="$(echo "$h" | field version)"; [ -n "$v" ] && ok "running build: AeroOS $v" || bad "the running API is an older build (no version in /api/health)" "rebuild: docker compose up -d --build" api
  echo "$h" | grep -q '"temporal":"up"' || bad "API cannot reach Temporal yet" "wait a minute; else docker compose logs --tail 80 temporal api" temporal
  echo "$h" | grep -q '"storage":"up"' || bad "API cannot reach object storage" "docker compose logs --tail 80 minio api" minio
else bad "API health answered $c" "docker compose logs --tail 120 api" api; fi
c=$(http "$KC/realms/aeroos/.well-known/openid-configuration"); [ "$c" = 200 ] && ok "Keycloak realm 'aeroos'" || bad "Keycloak realm answered $c" "docker compose logs --tail 80 keycloak (realm import)" keycloak
c=$(http "http://localhost:3592/_cerbos/health"); [ "$c" = 200 ] && ok "Cerbos" || bad "Cerbos answered $c" "docker compose logs --tail 80 cerbos (policy compile errors show here)" cerbos
c=$(http "http://localhost:9000/minio/health/live"); [ "$c" = 200 ] && ok "MinIO" || bad "MinIO answered $c" "docker compose logs --tail 50 minio" minio
c=$(http "http://localhost:8200/v1/sys/health"); [ "$c" = 200 ] && ok "OpenBao (signing)" || bad "OpenBao answered $c (sealed or down)" "docker compose logs --tail 50 openbao openbao-init" openbao
c=$(http "http://localhost:8233/"); [ "$c" = 200 ] && ok "Temporal UI" || bad "Temporal UI answered $c" "docker compose logs --tail 50 temporal-ui" temporal-ui

echo "3. Signed-in journeys"
token() {
  curl -s --max-time 20 -d grant_type=password -d client_id=aeroos-web -d "username=$1" -d "password=$PW" -d scope=openid \
    "$KC/realms/aeroos/protocol/openid-connect/token" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}
get() { http -H "authorization: Bearer $1" "$WEB/api$2"; }
OCC=$(token occ.controller)
if [ -z "$OCC" ]; then bad "cannot sign in as occ.controller (password grant)" "Keycloak realm import / user passwords: docker compose logs keycloak" keycloak
else
  ok "signed in as occ.controller"
  c=$(get "$OCC" /me); if [ "$c" = 200 ] && body | grep -q '"operators":\["FJR","NKX"\]\|"operators":\["NKX","FJR"\]'; then ok "/me: $(body | field operatorId), member of NKX and FJR"; else bad "/me answered $c: $(body | head -c 200)" "401 → token issuer/audience vs OIDC_ISSUER/OIDC_AUDIENCE; 403 → Cerbos" api; fi
  c=$(get "$OCC" "/ops/timeline"); n=$(body | grep -o '"flightNo"' | wc -l); [ "$c" = 200 ] && [ "$n" -gt 0 ] && ok "OCC timeline: $n flights" || bad "OCC timeline answered $c with $n flights" "demo schedule: SEED_DEMO=true; docker compose logs api | grep -i demo" api
  c=$(get "$OCC" "/ops/dispatch"); [ "$c" = 200 ] && ok "dispatch board ($(body | grep -o '"flightNo"' | wc -l) flights today)" || bad "dispatch board answered $c" "migration 0024: docker compose logs --tail 80 api" api
  c=$(get "$OCC" "/ops/dispatch/permits"); [ "$c" = 200 ] && ok "overflight permits ($(body | grep -o '"number"' | wc -l))" || bad "permits answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$OCC" "/ops/crew"); [ "$c" = 200 ] && ok "crew & FTL ($(body | grep -o '"rank"' | wc -l) crew)" || bad "crew answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$OCC" "/ops/roster"); [ "$c" = 200 ] && ok "roster grid ($(body | grep -o '"flightNo"' | wc -l) legs, open flights listed)" || bad "roster grid answered $c" "migration 0025: docker compose logs --tail 80 api" api
  c=$(http -X POST -H "authorization: Bearer $OCC" -H 'content-type: application/json' -H "idempotency-key: smoke-$(date +%s)" -d '{"hours":24}' "$WEB/api/ops/recovery")
  if [ "$c" = 200 ] || [ "$c" = 201 ]; then
    run=$(body | field id); st=$(body | field status)
    for i in $(seq 1 30); do [ "$st" = RUNNING ] || break; sleep 3; get "$OCC" "/ops/recovery/$run" >/dev/null; st=$(body | field status); done
    case "$st" in
      PROPOSED) ok "optimiser round trip (API → Temporal → Python → API): $run PROPOSED";;
      FAILED) bad "optimiser run $run FAILED: $(body | field error)" "docker compose logs --tail 80 optimiser" optimiser;;
      *) bad "optimiser run $run still $st after 90 s" "is the optimiser worker polling? docker compose logs --tail 80 optimiser temporal" optimiser;;
    esac
  elif [ "$c" = 422 ]; then ok "optimiser: nothing to recover right now ($(body | field message))"
  else bad "starting an optimiser run answered $c: $(body | head -c 200)" "docker compose logs --tail 80 api" api; fi
fi
CAMO=$(token camo.engineer)
if [ -n "$CAMO" ]; then
  c=$(get "$CAMO" "/camo/due"); n=$(body | grep -o '"ref"' | wc -l); [ "$c" = 200 ] && [ "$n" -gt 0 ] && ok "CAMO due list: $n items" || bad "CAMO due list answered $c with $n items" "seeds: docker compose logs api | grep -i seed" api
  c=$(get "$CAMO" "/camo/mel-items?scope=open"); [ "$c" = 200 ] && ok "MEL deferrals" || bad "MEL answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/camo/directives?scope=all"); [ "$c" = 200 ] && ok "AD/SB register ($(body | grep -o '"kind"' | wc -l) directives)" || bad "AD/SB register answered $c" "migration 0021: docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/camo/health/engines"); [ "$c" = 200 ] && ok "engine health ($(body | grep -o '"engineType"' | wc -l) engines)" || bad "engine health answered $c" "migration 0026: docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/camo/health/damage?tail=LN-ABD"); [ "$c" = 200 ] && ok "structural damage chart ($(body | grep -o '"disposition"' | wc -l) damages on LN-ABD)" || bad "damage chart answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/camo/components"); [ "$c" = 200 ] && ok "tracked components ($(body | grep -o '"serial"' | wc -l) installed)" || bad "components answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/org/documents"); [ "$c" = 200 ] && ok "document control ($(body | grep -o '"code"' | wc -l) controlled documents)" || bad "document control answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/quality/audits"); [ "$c" = 200 ] && ok "quality audits ($(body | grep -o '"plannedFor"' | wc -l))" || bad "quality audits answered $c" "migration 0022: docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/safety/occurrences"); [ "$c" = 200 ] && ok "safety reports reachable" || bad "safety reports answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/amo/supply/orders?scope=all"); [ "$c" = 200 ] && ok "purchase orders ($(body | grep -o '"vendorName"' | wc -l))" || bad "purchase orders answered $c" "migration 0023: docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/amo/supply/vendors"); [ "$c" = 200 ] && ok "approved supplier list ($(body | grep -o '"approvalRef"' | wc -l))" || bad "suppliers answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$CAMO" "/amo/ncr?scope=all"); [ "$c" = 200 ] && ok "non-conformance reports ($(body | grep -o '"partNo"' | wc -l))" || bad "NCR answered $c" "docker compose logs --tail 80 api" api
else bad "cannot sign in as camo.engineer" "" keycloak; fi
FIN=$(token finance)
if [ -n "$FIN" ]; then
  c=$(get "$FIN" "/exec/dashboard"); [ "$c" = 200 ] && ok "executive dashboard ($(body | grep -o '"key":"[a-z_]*","label"' | wc -l) figures)" || bad "executive dashboard answered $c: $(body | head -c 160)" "migration 0027: docker compose logs --tail 80 api" api
  c=$(get "$FIN" "/finance/ledger"); if [ "$c" = 200 ] && body | grep -q '"balanced":true'; then ok "general ledger: trial balance balances"; else bad "ledger answered $c: $(body | head -c 160)" "docker compose logs --tail 80 api" api; fi
  c=$(get "$FIN" "/amo/billing"); [ "$c" = 200 ] && ok "third-party maintenance billing ($(body | grep -o '"customerName"' | wc -l) orders/invoices)" || bad "billing answered $c" "docker compose logs --tail 80 api" api
else bad "cannot sign in as finance" "existing installs: run scripts/add-finance-user.sh once" keycloak; fi
CREW=$(token ola.hansen)
if [ -n "$CREW" ]; then
  c=$(get "$CREW" "/crew/me"); if [ "$c" = 200 ] && body | grep -q '"crew":{'; then ok "crew hub for ola.hansen ($(body | grep -o '"report"' | wc -l) duties)"; else bad "crew hub answered $c: $(body | head -c 160)" "crew record not linked yet? the demo links CPT-01A to ola.hansen at API start: docker compose restart api" api; fi
else bad "cannot sign in as ola.hansen" "existing installs: run scripts/add-crew-user.sh once" keycloak; fi
KM=$(token k.mwangi)
if [ -n "$KM" ]; then c=$(get "$KM" "/amo/task-cards"); [ "$c" = 200 ] && ok "hangar task cards ($(body | grep -o '"tail"' | wc -l))" || bad "task cards answered $c" "docker compose logs --tail 80 api" api; fi
AUD=$(token auditor)
if [ -n "$AUD" ]; then
  c=$(get "$AUD" "/compliance/matrix"); [ "$c" = 200 ] && ok "compliance matrix ($(body | grep -o '"reference"' | wc -l) requirements)" || bad "compliance matrix answered $c" "docker compose logs --tail 80 api" api
  c=$(get "$AUD" "/platform/audit/verify?chain=ops"); if [ "$c" = 200 ] && body | grep -q '"ok":true'; then ok "audit chain 'ops' verifies ($(body | field count) entries)"; else bad "audit verify answered $c: $(body | head -c 200)" "docker compose logs --tail 80 api" api; fi
  # Write-once storage: anchoring puts an object under Object Lock (COMPLIANCE) — proves the S3 server supports it.
  c=$(http -X POST -H "authorization: Bearer $AUD" -H "idempotency-key: smoke-anchor-$(date +%s)" "$WEB/api/platform/audit/anchor?chain=camo")
  if [ "$c" = 200 ] || [ "$c" = 201 ]; then
    case "$(body)" in
      *'"anchored":true'*) ok "audit anchor written to write-once storage (camo chain, seq $(body | field seq))";;
      *'"seq":null'*) ok "audit anchoring reachable (camo chain has no entries yet)";;
      *) ok "audit chain camo already anchored at its head (seq $(body | field seq))";;
    esac
  else bad "anchoring answered $c: $(body | head -c 200)" "object storage must support Object Lock: docker compose logs --tail 80 minio api" minio; fi
  c=$(get "$AUD" "/platform/signing-key"); [ "$c" = 200 ] && ok "signing key $(body | field keyId), fingerprint $(body | field fingerprint | cut -c1-16)…" || bad "signing key answered $c" "OpenBao transit: docker compose logs openbao-init api" openbao
fi

echo "4. Integrations"
c=$(http -X POST -H 'content-type: text/plain' -H 'x-api-key: wrong-key-wrong-key' --data-binary $'MVT\nNK601/01\nAD0000' "$WEB/api/integrations/movements/mvt")
[ "$c" = 401 ] && ok "movement endpoint refuses a wrong key" || bad "movement endpoint with a wrong key answered $c (expected 401)" "MOVEMENT_API_KEYS in docker-compose.yml" api
c=$(http -X POST -H 'content-type: text/plain' -H "x-api-key: $NKX_KEY" --data-binary $'MVT\nNK999/01.LNABC.OSL\nAD0000' "$WEB/api/integrations/movements/mvt")
[ "$c" = 200 ] || [ "$c" = 201 ] && body | grep -q 'No flight NK999' && ok "movement endpoint parses MVT and answers per message" || bad "movement endpoint answered $c: $(body | head -c 200)" "docker compose logs --tail 80 api" api

echo
echo "Result: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Logs of the services involved (last 40 lines each) — send this whole output when asking for help:"
  for s in $(printf '%s\n' "${FAILED[@]}" | grep -v '^$' | sort -u); do
    echo "----- $s"; docker compose logs --no-color --tail 40 "$s" 2>&1 | sed 's/^/  /'
  done
  exit 1
fi
echo "All good. Open $WEB (users in README §1, password '$PW')."
