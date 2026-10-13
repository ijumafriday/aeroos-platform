#!/usr/bin/env bash
# AeroOS restore from a backup made by backup.sh.
#   scripts/dr/restore.sh <backup-dir> [target-db]            default target: aeroos_restore (a drill copy)
#   scripts/dr/restore.sh <backup-dir> aeroos --replace       replace the live database (stop api/worker first!)
#   add --objects to also copy the buckets back into object storage (real disaster recovery)
source "$(dirname "$0")/lib.sh"
SRC="${1:?backup directory}"; TARGET="${2:-aeroos_restore}"; shift $(( $# < 2 ? $# : 2 ))
REPLACE=0; OBJECTS=0
for a in "$@"; do case "$a" in --replace) REPLACE=1;; --objects) OBJECTS=1;; *) echo "unknown option $a"; exit 2;; esac; done
SRC="$(cd "$SRC" && pwd)"

log "checking backup integrity (MANIFEST.sha256)"
( cd "$SRC" && if command -v sha256sum >/dev/null; then sha256sum -c --quiet MANIFEST.sha256; else shasum -a 256 -c --quiet MANIFEST.sha256; fi ) \
  || { echo "Backup files do not match their manifest — refusing to restore"; exit 1; }

if [ "$TARGET" = "$DB" ] && [ "$REPLACE" != 1 ]; then echo "Refusing to overwrite the live database '$DB' without --replace"; exit 2; fi

log "roles (idempotent; development passwords — in production the roles come from your secret store)"
sed '/CREATE SCHEMA/d' "$ROOT/infra/postgres/upgrade/ensure-roles.sql" | pg psql -d postgres -X -q -v ON_ERROR_STOP=1 -f - >/dev/null

log "database → $TARGET"
pg psql -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)" -c "CREATE DATABASE \"$TARGET\" TEMPLATE template0 OWNER aeroos_owner"
# Ownership and grants come with the dump (the module roles exist, see above), so every module role works as before.
pg pg_restore --exit-on-error -d "$TARGET" < "$SRC/aeroos.dump"

if [ "$OBJECTS" = 1 ]; then
  for b in $BUCKETS; do
    [ -d "$SRC/objects/$b" ] || { log "no copy of bucket $b in the backup"; continue; }
    log "object storage: restoring bucket $b"
    # The anchors bucket is write-once (Object Lock): recreate it locked; existing objects are never overwritten.
    # mirror does not carry per-object retention: re-apply the default retention (the API sets it on new
    # anchors) with `mc retention set --recursive compliance <days>d src/aeroos-audit-anchors` per your policy.
    if [ "$b" = "aeroos-audit-anchors" ]; then mc_run "$SRC/objects" mb --ignore-existing --with-lock "src/$b"; else mc_run "$SRC/objects" mb --ignore-existing "src/$b"; fi
    mc_run "$SRC/objects" mirror --quiet "@DIR@/$b" "src/$b"
  done
fi
log "restored into $TARGET"
