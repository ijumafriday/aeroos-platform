#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'FAIL: docker required for upgrade assurance' >&2; exit 2; }
python3 - <<'PY'
import json
x=json.load(open('tests/upgrade/supported-releases.json'))
assert x['releases'] and all(isinstance(r['migrationCutoff'],int) for r in x['releases'])
PY
mapfile -t CASES < <(python3 - <<'PY'
import json
for r in json.load(open('tests/upgrade/supported-releases.json'))['releases']:
 print(f"{r['version']}|{r['migrationCutoff']}")
PY
)
for c in "${CASES[@]}"; do
  version=${c%%|*}; cutoff=${c##*|}; name="aeroos-upgrade-${version//./-}-$$"
  trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aeroos postgis/postgis:16-3.4 >/dev/null
  for _ in $(seq 1 60); do docker exec "$name" pg_isready -U postgres -d aeroos >/dev/null 2>&1 && break; sleep 1; done
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d aeroos < infra/postgres/init/00-roles.sql >/dev/null
  for f in apps/api/db/migrations/*.sql; do n=$(basename "$f" | cut -c1-4); [ "$((10#$n))" -le "$cutoff" ] || continue; docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U aeroos_owner -d aeroos < "$f" >/dev/null; done
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d aeroos < tests/upgrade/representative.sql >/dev/null
  pre=$(docker exec "$name" psql -At -U postgres -d aeroos -c "select (select count(*) from compliance.operator_profiles where operator_id='UPG')||':'||(select count(*) from org.personnel where operator_id='UPG')||':'||(select count(*) from ops.flights where operator_id='UPG')")
  for f in apps/api/db/migrations/*.sql; do n=$(basename "$f" | cut -c1-4); [ "$((10#$n))" -gt "$cutoff" ] || continue; docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U aeroos_owner -d aeroos < "$f" >/dev/null; done
  post=$(docker exec "$name" psql -At -U postgres -d aeroos -c "select (select count(*) from compliance.operator_profiles where operator_id='UPG')||':'||(select count(*) from org.personnel where operator_id='UPG')||':'||(select count(*) from ops.flights where operator_id='UPG')")
  [ "$pre" = '1:1:1' ] && [ "$post" = "$pre" ] || { echo "FAIL: $version data preservation pre=$pre post=$post" >&2; exit 1; }
  docker exec "$name" psql -At -U postgres -d aeroos -c "select flight_no||':'||tail from ops.flights where id='UPG-F1'" | grep -qx 'UPG101:5Y-UPG'
  docker rm -f "$name" >/dev/null; trap - EXIT
  echo "PASS  upgrade $version -> current preserves representative data"
done
