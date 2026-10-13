#!/usr/bin/env bash
# Adds the demo flight crew sign-in (ola.hansen / aeroos, role flight_crew, operator NKX) to an EXISTING Keycloak
# realm. Fresh installs get it from infra/keycloak/aeroos-realm.json; Keycloak does not re-import a realm that
# already exists, so installs from 0.12 and earlier run this once:  scripts/add-crew-user.sh
set -euo pipefail
cd "$(dirname "$0")/.."
KC=(docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh)
"${KC[@]}" config credentials --server http://localhost:8080 --realm master --user admin --password admin >/dev/null
if "${KC[@]}" get users -r aeroos -q username=ola.hansen --fields username | grep -q ola.hansen; then
  echo "ola.hansen already exists"; exit 0
fi
"${KC[@]}" create users -r aeroos -s username=ola.hansen -s enabled=true -s firstName=Ola -s lastName=Hansen \
  -s email=ola.hansen@nordkapp.example -s emailVerified=true >/dev/null
"${KC[@]}" set-password -r aeroos --username ola.hansen --new-password aeroos
"${KC[@]}" add-roles -r aeroos --uusername ola.hansen --rolename flight_crew
USER_ID=$("${KC[@]}" get users -r aeroos -q username=ola.hansen --fields id --format csv --noquotes | tr -d '\r')
GROUP_ID=$("${KC[@]}" get groups -r aeroos -q search=NKX --fields id,name --format csv --noquotes | tr -d '\r' | awk -F, '$2=="NKX"{print $1}')
"${KC[@]}" update "users/$USER_ID/groups/$GROUP_ID" -r aeroos -s realm=aeroos -s userId="$USER_ID" -s groupId="$GROUP_ID" -n
echo "ola.hansen added (password: aeroos)"
