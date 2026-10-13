#!/usr/bin/env bash
# Restore drill: back up the running stack, restore into a scratch database, and prove the restored copy is
# complete and untampered — every audit chain recomputes, contains the head recorded at backup time, and
# matches its latest signed anchor. Leaves the live system untouched. Run monthly; keep the output as evidence.
#   scripts/dr/drill.sh
source "$(dirname "$0")/lib.sh"
START=$(date +%s)
# The scratch copy holds every operator's data: always remove it, whatever happens.
cleanup() { pg psql -d postgres -X -q -c 'DROP DATABASE IF EXISTS aeroos_drill WITH (FORCE)' >/dev/null 2>&1 || true; }
trap cleanup EXIT
OUT="$("$(dirname "$0")/backup.sh" | tail -1)"
"$(dirname "$0")/restore.sh" "$OUT" aeroos_drill
log "verifying the restored audit chains against the backup heads and the write-once anchors"
ANCHORS="$OUT/objects/aeroos-audit-anchors"
if [ -d "$ANCHORS" ]; then OBJ=(--anchors-dir); else OBJ=(--no-objects); ANCHORS=""; log "WARNING: no copy of the anchors bucket — weaker check"; fi
set +e
if [ "${AEROOS_LOCAL:-0}" = 1 ]; then
  PGDATABASE=aeroos_drill ${AEROOS_VERIFY:-node $ROOT/apps/api/dist/tools/verify-chains.js} --expect "$OUT/heads.live.json" "${OBJ[@]}" $ANCHORS | tee "$OUT/drill-report.txt"
else
  API="$(compose ps -q api)"
  docker cp "$OUT/heads.live.json" "$API:/tmp/heads.json"
  [ -n "$ANCHORS" ] && docker cp "$ANCHORS" "$API:/tmp/anchors" && ANCHORS=/tmp/anchors
  compose exec -T -e PGHOST=postgres -e PGUSER=postgres -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" -e PGDATABASE=aeroos_drill api \
    node dist/tools/verify-chains.js --expect /tmp/heads.json "${OBJ[@]}" $ANCHORS | tee "$OUT/drill-report.txt"
fi
RC=${PIPESTATUS[0]}
set -e
log "drill finished in $(( $(date +%s) - START ))s, result $([ "$RC" = 0 ] && echo PASS || echo FAIL), report: $OUT/drill-report.txt"
exit $RC
