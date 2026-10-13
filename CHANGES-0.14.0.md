# AeroOS 0.14.0 — Round 14: Engineering health (update over 0.13.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.14.0"
# unzip aeroos-0.14.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0026 + demo seed 9011 run automatically
scripts/smoke.sh                # reports AeroOS 0.14.0, checks engine health and the damage chart
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.13.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New — CAMO → Engine Health & Structural Damage
- Engine trend monitoring: EGT margin limits and removal forecast, ΔEGT/ΔN2/ΔFF step shifts, vibration, with trend
  charts and a recommended action per alert; alerts are notified once and closed by an engineer with the action taken.
- Oil consumption per uplift (line maintenance records uplifts; hours come from the aircraft counters).
- Structural damage chart: zone × type matrix, position map, SRM assessment (allowable / repair / beyond SRM),
  interacting damages, approved repair data, permanent and temporary repairs, repeat inspections.
- Open damage beyond limits, an expired temporary repair or an overdue repeat inspection grounds the aircraft
  (airworthiness sweep → OCC).

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0026_camo_engineering_health.sql`, `apps/api/db/seeds/9011_engineering_health.sql`
- A `apps/api/src/modules/camo/health.service.ts`, `health.tables.ts`; M `camo.module.ts`, `programme.service.ts`
- M `apps/api/src/platform/authz/authz.service.ts`
- A `apps/web/src/features/engineering/Health.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/mro-domain/src/engine-health.ts`, `structural.ts`, `health.test.ts`; M `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/engine_health.yaml`, `structural_damage.yaml`, `tests/health_test.yaml`
- A `e2e/tests/engineering-health.spec.ts`; M `scripts/smoke.sh`
- A `docs/adr/0024-engineering-health.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.14.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
