# AeroOS 0.15.0 — Round 15: Business (update over 0.14.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.15.0"
# unzip aeroos-0.15.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0027 + demo seed 9012 run automatically
scripts/add-finance-user.sh     # once, on an existing install: role finance_controller + sign-in finance (new installs have it)
scripts/smoke.sh                # reports AeroOS 0.15.0, checks billing, the ledger and the executive dashboard
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.14.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New
- **AMO → Third-party Maintenance & Billing:** customers and terms; quote → customer approval (credit check) → work
  booked → completed → invoice (overrun above 10 % needs the customer's approval) → payments → credit notes;
  receivables ageing; gap-free invoice numbers per issuer.
- **Finance & Business → General Ledger:** automatic double-entry postings from invoices, payments and goods
  receipts; trial balance, P&L by cost centre, manual journals, month close in order, CSV journal export for the ERP.
- **Finance & Business → Executive Dashboard:** operations, fleet and airworthiness, engineering, crew, safety &
  quality, revenue and receivables.
- **Organization → Enterprise Structure:** group and legal entities, their approvals (AOC, Part-145 …) with expiry,
  cost centres.
- New sign-in `finance` (role `finance_controller`).

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0027_business.sql`, `apps/api/db/seeds/9012_business.sql`
- A `apps/api/src/modules/amo/billing.service.ts`; M `amo.module.ts`, `supply.service.ts`
- A `apps/api/src/modules/org/finance.service.ts`; M `org.module.ts`
- A `apps/api/src/modules/exec/exec.module.ts`, `apps/api/src/modules/camo/kpis.ts`, `apps/api/src/modules/ops/kpis.ts`; M `camo.module.ts`, `ops.module.ts`, `apps/api/src/app.module.ts`
- M `apps/api/src/platform/authz/authz.service.ts`
- A `apps/web/src/features/business/{Billing,Ledger,Executive,Enterprise}.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/mro-domain/src/billing.ts`, `billing.test.ts`; A `packages/org-domain/src/ledger.ts`, `ledger.test.ts`; M both `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/{billing,ledger,enterprise,executive_dashboard}.yaml`, `tests/business_test.yaml`
- M `infra/keycloak/aeroos-realm.json` (role finance_controller, user finance)
- A `e2e/tests/business.spec.ts`; A `scripts/add-finance-user.sh`; M `scripts/smoke.sh`
- A `docs/adr/0025-business.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.15.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
