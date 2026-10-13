# AeroOS 0.11.0 — Round 11: Supply chain (update over 0.10.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.11.0"
# unzip aeroos-0.11.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0023 + demo seed 9009 run automatically
scripts/smoke.sh                # reports AeroOS 0.11.0 and checks the new areas
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.10.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New — AMO → Procurement & Supply Chain
- Approved supplier list (quality manager); suspended or lapsed suppliers cannot be used.
- Requisitions (also one per task-card shortage), quotes, award → purchase order.
- Approval limit 5,000 USD with currency conversion at maintained reference rates and split-order detection;
  approver ≠ raiser.
- Receiving with incoming inspection: release certificate rules, condition at least as ordered, serials.
- Customs bond for imports; clearance puts parts into stock and fills task-card shortages.
- Warranty claims (one per unit, decided by someone else), exchanges with overdue cores, PBH monthly statements.
- Exchange rates (USD per unit) maintained by the quality or CAMO manager; USD is always present.

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0023_supply_chain.sql`, `apps/api/db/seeds/9009_supply_chain.sql`
- A `apps/api/src/modules/amo/supply.service.ts`; M `amo.module.ts`, `stores.service.ts`
- M `apps/api/src/platform/authz/authz.service.ts`
- A `apps/web/src/features/stores/Supply.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/mro-domain/src/supply.ts`, `supply.test.ts`; M `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/procurement.yaml`, `tests/procurement_test.yaml`
- A `e2e/tests/supply.spec.ts`; M `scripts/smoke.sh`
- A `docs/adr/0021-supply-chain.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.11.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
