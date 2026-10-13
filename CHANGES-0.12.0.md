# AeroOS 0.12.0 — Round 12: Dispatch (update over 0.11.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.12.0"
# unzip aeroos-0.12.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0024 + demo seed 9010 run automatically
scripts/smoke.sh                # reports AeroOS 0.12.0 and checks the dispatch board
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.11.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New — Flight Ops → Dispatch & Load Control
- Load sheet: standard masses, ZFW/TOW/LW against structural and runway-regulated limits, centre of gravity
  (%MAC) at zero-fuel, take-off and landing mass, seats, 4-yearly reweighing.
- Fuel plan (basic scheme) with contingency, alternate and final reserve; tankering advice from fuel prices.
- ICAO flight plan message; overflight permits per route country.
- Dispatch release only when every check passes; last-minute changes within 500 kg / 10 pax keep it; a larger
  change, a tail swap, a cancellation, a new off-block time or a newly failing check withdraws it.
- Reference data: overflight permits and per-operator fuel prices (OCC). Printable briefing package.

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0024_ops_dispatch.sql`, `apps/api/db/seeds/9010_dispatch.sql`
- A `apps/api/src/modules/ops/dispatch.service.ts`; M `ops.module.ts`, `ops.repository.ts`
- M `apps/api/src/platform/authz/authz.service.ts`
- A `apps/web/src/features/ops/Dispatch.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/ops-domain/src/dispatch.ts`, `dispatch.test.ts`; M `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/dispatch.yaml`, `tests/dispatch_test.yaml`
- A `e2e/tests/dispatch.spec.ts`; M `scripts/smoke.sh`
- A `docs/adr/0022-dispatch.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.12.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
