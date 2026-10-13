#!/usr/bin/env bash
# Adds the finance role and demo sign-in (finance / aeroos, role finance_controller, operator NKX) to an EXISTING
# Keycloak realm. Fresh installs get both from infra/keycloak/aeroos-realm.json; Keycloak does not re-import a
# realm that already exists, so installs from 0.14 and earlier run this once:  scripts/add-finance-user.sh
set -euo pipefail
cd "$(dirname "$0")/.."
KC=(docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh)
"${KC[@]}" config credentials --server http://localhost:8080 --realm master --user admin --password admin >/dev/null
if ! "${KC[@]}" get roles/finance_controller -r aeroos >/dev/null 2>&1; then
  "${KC[@]}" create roles -r aeroos -s name=finance_controller -s 'description=Finance: customers, invoicing, payments, general ledger, period close' >/dev/null
  echo "role finance_controller created"
fi
if "${KC[@]}" get users -r aeroos -q username=finance --fields username | grep -q '"finance"'; then
  echo "finance already exists"; exit 0
fi
"${KC[@]}" create users -r aeroos -s username=finance -s enabled=true -s firstName=Silje -s lastName=Moe \
  -s email=finance@nordkapp.example -s emailVerified=true >/dev/null
"${KC[@]}" set-password -r aeroos --username finance --new-password aeroos
"${KC[@]}" add-roles -r aeroos --uusername finance --rolename finance_controller
USER_ID=$("${KC[@]}" get users -r aeroos -q username=finance --fields id --format csv --noquotes | tr -d '\r')
GROUP_ID=$("${KC[@]}" get groups -r aeroos -q search=NKX --fields id,name --format csv --noquotes | tr -d '\r' | awk -F, '$2=="NKX"{print $1}')
"${KC[@]}" update "users/$USER_ID/groups/$GROUP_ID" -r aeroos -s realm=aeroos -s userId="$USER_ID" -s groupId="$GROUP_ID" -n
echo "finance added (password: aeroos)"
