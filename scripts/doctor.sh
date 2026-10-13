#!/usr/bin/env bash
# AeroOS pre-flight: run BEFORE `docker compose up --build`. Checks the things that most often break a first run.
# Works on Linux, macOS and Windows (Git Bash or WSL). Read-only.
set -u
cd "$(dirname "$0")/.."
PASS=0; WARN=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

echo "AeroOS doctor — $(date -u +%FT%TZ)"
echo "Docker"
if ! command -v docker >/dev/null; then bad "docker not found — install Docker Desktop"; else
  if ! docker info >/dev/null 2>&1; then bad "Docker is installed but not running — start Docker Desktop"; else
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) running"
    if docker compose version >/dev/null 2>&1; then
      v="$(docker compose version --short 2>/dev/null)"; ok "Docker Compose $v"
      case "$v" in 1.*|2.[0-9].*|2.1[0-9].*) bad "Compose $v is too old (need ≥ 2.20 for 'depends_on: condition' and '--wait')";; esac
    else bad "'docker compose' (v2) not available"; fi
    mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
    gb=$(( mem / 1024 / 1024 / 1024 ))
    if [ "$gb" -ge 10 ]; then ok "Docker memory ${gb} GB"; elif [ "$gb" -ge 7 ]; then warn "Docker memory ${gb} GB — 10–12 GB recommended (Settings → Resources); Kafka/Keycloak/Temporal may be OOM-killed"; else bad "Docker memory ${gb} GB — raise to 10–12 GB in Docker Desktop → Settings → Resources"; fi
    cpus=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo 0); [ "$cpus" -ge 4 ] && ok "$cpus CPUs" || warn "$cpus CPUs — 4+ recommended (first build compiles everything)"
    arch=$(docker info --format '{{.Architecture}}' 2>/dev/null)
    case "$arch" in aarch64|arm64) warn "ARM host ($arch): postgis/postgis has no ARM image and runs under emulation (slower but works; enable Rosetta in Docker Desktop on Apple Silicon)";; *) ok "Architecture $arch";; esac
    free=$(docker system df --format '{{.Reclaimable}}' 2>/dev/null | head -1); [ -n "$free" ] && ok "Docker disk reclaimable: $free"
  fi
fi

echo "Ports (must be free before starting)"
for p in 5432 7233 8080 8081 8200 8233 3592 9000 9001 29092; do
  if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then
    # --filter publish understands port ranges (Docker shows 9000-9001->9000-9001/tcp as one range)
    who="$(docker ps --filter "publish=$p" --format '{{.Names}}' 2>/dev/null | head -1)"
    if [ -n "$who" ] && echo "$who" | grep -q '^aeroos'; then ok "$p in use by $who (this stack — fine)"; else bad "port $p is already in use${who:+ by container $who} — stop that program or change the port in docker-compose.yml"; fi
  else ok "$p free"; fi
done

echo "Files"
# CRLF breaks shell scripts run inside Linux containers; PostgreSQL tolerates it in .sql files.
crlf_sh=$(grep -rlI $'\r' --include='*.sh' infra scripts 2>/dev/null | head -8)
crlf_other=$(grep -rlI $'\r' --include='*.sql' --include='*.conf*' --include='*.template' --include='*.yaml' --include='*.yml' --include='*.json' infra apps/web docker-compose.yml 2>/dev/null | head -8)
if [ -n "$crlf_sh$crlf_other" ]; then
  warn "Windows line endings (CRLF) — usually git's core.autocrlf. Harmless for the files below today, but fix it once:"
  echo "$crlf_sh $crlf_other" | tr ' ' '\n' | grep -v '^$' | sed 's/^/      /'
  echo "      git config core.autocrlf false && git add --renormalize . && git checkout -- .   (the repo's .gitattributes keeps LF from now on)"
else ok "line endings are LF"; fi
if [ -f pnpm-lock.yaml ] && pnpm -v >/dev/null 2>&1; then
  # The images install with --frozen-lockfile: a lockfile older than package.json fails the build.
  if pnpm install --frozen-lockfile --lockfile-only --ignore-scripts >/dev/null 2>&1; then ok "pnpm-lock.yaml matches every package.json"
  else bad "pnpm-lock.yaml is out of date with a package.json (the image build will fail) — run: pnpm install   then rebuild"; fi
elif [ -f pnpm-lock.yaml ]; then ok "pnpm-lock.yaml present (install pnpm to check it is in sync)"; fi
[ -f pnpm-lock.yaml ] || bad "pnpm-lock.yaml missing — all builds are blocked until an authentic lockfile is generated with pnpm 9.15.0"
[ -f infra/keycloak/aeroos-realm.json ] && ok "Keycloak realm present" || bad "infra/keycloak/aeroos-realm.json missing"

echo "Optional (local development without Docker builds)"
command -v node >/dev/null && { nv=$(node -v); case "$nv" in v2[2-9]*|v[3-9]*) ok "Node $nv";; *) warn "Node $nv — Node 22+ needed for local development";; esac; } || warn "Node not installed (only needed for local development)"
pv="$(pnpm -v 2>/dev/null | head -1)"
case "$pv" in [0-9]*) ok "pnpm $pv";; *) warn "pnpm not available (run 'corepack enable' for local development)";; esac

echo
echo "Result: $PASS ok, $WARN warning(s), $FAIL problem(s)"
[ "$FAIL" -eq 0 ] && echo "Ready: docker compose up --build   (then: scripts/smoke.sh)" || echo "Fix the problems above first."
exit $(( FAIL > 0 ))
