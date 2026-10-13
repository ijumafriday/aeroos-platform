#!/usr/bin/env bash
# AeroOS backup: database (custom format, all schemas), object storage (documents + audit anchors), and a
# manifest with SHA-256 of every file and the head of every audit chain at backup time.
#   scripts/dr/backup.sh [target-dir]        default: backups/<UTC timestamp>
source "$(dirname "$0")/lib.sh"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$ROOT/backups/$TS}"
mkdir -p "$OUT/objects"
OUT="$(cd "$OUT" && pwd)"

# Heads first: every entry committed before this point is in the dump's (later) snapshot, so the restored
# database must contain each of these heads unchanged.
log "audit chain heads at backup time"
pg psql -d "$DB" -X -A -t -c "select coalesce(json_agg(h order by h.chain), '[]') from (select distinct on (chain) chain, seq, hash from platform.audit_log order by chain, seq desc) h" > "$OUT/heads.live.json"
log "database $DB → $OUT/aeroos.dump"
pg pg_dump -Fc -d "$DB" > "$OUT/aeroos.dump"

for b in $BUCKETS; do
  log "object storage bucket $b → objects/$b"
  if ! mc_run "$OUT/objects" mirror --quiet --preserve "src/$b" "@DIR@/$b"; then
    # Without the write-once anchors a restore cannot be proven untampered: that is a failed backup.
    if [ "${AEROOS_ALLOW_NO_OBJECTS:-0}" = 1 ]; then log "WARNING: bucket $b not copied (AEROOS_ALLOW_NO_OBJECTS=1)"; else echo "Bucket $b could not be copied — backup FAILED"; exit 1; fi
  fi
done

log "manifest"
SUM="sha256sum"; command -v sha256sum >/dev/null || SUM="shasum -a 256"
( cd "$OUT" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 $SUM ) > "$OUT/MANIFEST.sha256"
cat > "$OUT/backup.json" <<JSON
{ "takenAt": "$TS", "database": "$DB", "buckets": "$(echo $BUCKETS)", "format": "pg_dump custom + mc mirror" }
JSON
log "done: $OUT ($(du -sh "$OUT" | cut -f1))"
echo "$OUT"
