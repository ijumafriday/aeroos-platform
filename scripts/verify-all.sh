#!/usr/bin/env bash
# Runs, in Docker, everything that cannot run in the build sandbox: the full repository build/typecheck/tests
# with real dependencies, the static integration checks, the Cerbos policy tests, Helm lint, and the browser
# journeys against the running stack. Nothing is installed on your machine and your node_modules are not touched.
#   scripts/verify-all.sh            (stack must be up for the browser journeys; skip them with --no-e2e)
# Writes verify-report.txt — send that file when something fails.
set -u
export MSYS_NO_PATHCONV=1   # Git Bash: do not rewrite /container/paths
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REPORT="$ROOT/verify-report.txt"
E2E=1; for a in "$@"; do [ "$a" = --no-e2e ] && E2E=0; done
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(docker compose ps -q web 2>/dev/null)" 2>/dev/null | awk '{print $1}')"
: > "$REPORT"
RESULTS=()
section() {
  local name="$1"; shift
  printf '\n\033[1m== %s\033[0m\n' "$name"
  local log; log="$(mktemp)"
  local start=$(date +%s)
  if "$@" >"$log" 2>&1; then RESULTS+=("PASS  $name ($(( $(date +%s) - start ))s)"); tail -5 "$log"
  else RESULTS+=("FAIL  $name ($(( $(date +%s) - start ))s)"); tail -40 "$log"; fi
  { echo "===================== $name"; cat "$log"; echo; } >> "$REPORT"
  rm -f "$log"
}

# 1. Repository: clean copy (no host node_modules), real install, static checks, build, typecheck, unit tests.
repo() {
  docker run --rm -v "$ROOT:/src:ro" node:22-bookworm-slim bash -ec '
    mkdir -p /work && cd /src && tar --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -C /work -xf -
    cd /work && corepack enable >/dev/null 2>&1 && corepack prepare pnpm@9.15.0 --activate >/dev/null 2>&1
    test -f pnpm-lock.yaml || { echo "pnpm-lock.yaml is mandatory" >&2; exit 2; }
    pnpm install --frozen-lockfile
    pnpm check
    pnpm build
    pnpm typecheck
    pnpm test
    pnpm lint'
}
section "Repository: install, static checks, build, typecheck, unit tests, lint" repo

# 1b. Optimiser (Python): unit tests with OR-Tools installed, so the CP-SAT tests run too.
optimiser() {
  docker run --rm -v "$ROOT/services/optimiser:/src:ro" python:3.12-slim sh -ec '
    cp -r /src /w && cd /w && pip install -q --disable-pip-version-check -r requirements.txt && python -m unittest discover -s tests -v'
}
section "Optimiser unit tests (CP-SAT)" optimiser

# 2. Authorisation policies: compile + every *_test.yaml.
policies() { docker run --rm -v "$ROOT/infra/cerbos/policies:/policies:ro" ghcr.io/cerbos/cerbos:0.39.0 compile /policies; }
section "Cerbos policies and policy tests" policies

# 3. Helm chart: dependencies, lint both profiles, render.
helm_lint() {
  docker run --rm -v "$ROOT/deploy/helm:/charts" -w /charts --entrypoint sh alpine/helm:3.16.3 -ec '
    cp -r aeroos /tmp/aeroos && cd /tmp
    helm dependency update aeroos >/dev/null
    helm lint aeroos -f aeroos/values-cloud.yaml
    helm lint aeroos -f aeroos/values-selfhosted.yaml
    helm template t aeroos -f aeroos/values-selfhosted.yaml >/dev/null && echo "template renders"'
}
section "Helm chart lint (cloud and self-hosted)" helm_lint


# 3b. Runtime security boundaries against the running stack.
runtime_boundaries() {
  [ -n "$NET" ] || { echo "stack not running; runtime boundary checks require docker compose up -d"; return 1; }
  docker compose exec -T -e PGPASSWORD=aeroos_owner postgres psql -U aeroos_owner -d aeroos -v ON_ERROR_STOP=1 < tests/integration/tenant-rls.sql
  docker compose exec -T worker node -e '
    const u=process.env.OIDC_TOKEN_URL,c=process.env.SERVICE_CLIENT_ID,s=process.env.SERVICE_CLIENT_SECRET,a=process.env.API_URL;
    (async()=>{const r=await fetch(u,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:c,client_secret:s})}); if(!r.ok) throw new Error(await r.text()); const t=(await r.json()).access_token; const x=await fetch(a+"/api/internal/platform/identity",{headers:{authorization:"Bearer "+t}}); if(!x.ok) throw new Error(await x.text()); const j=await x.json(); if(j.trusted!==true) throw new Error("identity probe did not confirm trust"); console.log("tenant RLS and workload identity pass")})()'
}
if [ "$E2E" = 1 ]; then section "Runtime tenant RLS + workload identity" runtime_boundaries; fi

# 4. Browser journeys against the running stack (Playwright's own image; localhost forwarded into the compose network).
e2e() {
  [ -n "$NET" ] || { echo "The stack is not running (docker compose up -d first), or use --no-e2e"; return 1; }
  docker run --rm --network "$NET" --ipc=host -v "$ROOT/e2e:/src:ro" -v "$ROOT/e2e-results:/out" \
    mcr.microsoft.com/playwright:v1.48.2-noble bash -ec '
    cp -r /src /e2e && cd /e2e
    test -d node_modules/@playwright/test || { echo "Playwright dependencies must come from the frozen workspace install" >&2; exit 2; }
    node docker/forward.mjs & sleep 1
    ./node_modules/.bin/playwright test --reporter=list --output=/out/artifacts || { cp -r test-results /out/ 2>/dev/null; exit 1; }'
}
if [ "$E2E" = 1 ]; then section "Browser journeys (Playwright, Chromium)" e2e; else RESULTS+=("SKIP  Browser journeys (--no-e2e)"); fi

echo; echo "== Summary"; printf '  %s\n' "${RESULTS[@]}" | tee -a "$REPORT"
echo "Full log: $REPORT$( [ -d e2e-results ] && echo "  · failed-journey screenshots/traces: e2e-results/" )"
printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL' && exit 1 || exit 0
