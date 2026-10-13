# Shared helpers for the AeroOS backup / restore / drill scripts.
# By default commands run inside the docker compose stack; set AEROOS_LOCAL=1 to use local pg_dump/psql
# (PGHOST/PGPORT/PGUSER/PGPASSWORD as usual) and a local `mc` (MinIO client) instead.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${AEROOS_DB:-aeroos}"
BUCKETS="${AEROOS_BUCKETS-aeroos-documents aeroos-audit-anchors}"
S3_URL="${AEROOS_S3_URL:-http://minio:9000}"
S3_KEY="${AEROOS_S3_KEY:-aeroos}"
S3_SECRET="${AEROOS_S3_SECRET:-aeroos-dev-secret}"
# minio/mc is gone from Docker Hub; Chainguard publishes the MinIO client (entrypoint: mc).
MC_IMAGE="${AEROOS_MC_IMAGE:-cgr.dev/chainguard/minio-client:latest}"

compose() { (cd "$ROOT" && docker compose "$@"); }

# pg tools: inside the postgres container (as the superuser), or local.
pg() {
  if [ "${AEROOS_LOCAL:-0}" = 1 ]; then "$@"; else compose exec -T postgres "$@" -U postgres; fi
}

# MinIO client with an alias "src" pointing at the stack's object storage. $1 = host directory; inside the
# command, write @DIR@ where that directory is meant (it is /backup in the container, the path itself locally).
mc_run() {
  local dir="$1"; shift
  local host="${S3_URL%%://*}://${S3_KEY}:${S3_SECRET}@${S3_URL#*://}"
  if [ "${AEROOS_LOCAL:-0}" = 1 ]; then
    MC_HOST_src="$host" mc "${@//@DIR@/$dir}"
  else
    local net; net="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q minio)" | awk '{print $1}')"
    docker run --rm --network "$net" -v "$dir:/backup" -e "MC_HOST_src=$host" -e MC_CONFIG_DIR=/tmp/.mc "$MC_IMAGE" "${@//@DIR@//backup}"
  fi
}

log() { printf '\033[1m[%s]\033[0m %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
