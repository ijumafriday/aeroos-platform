# AeroOS 0.10.0 — Round 10: Safety & Quality (update over 0.9.0)

## Apply
```bash
cd /c/Projects/aeroos-platform
git add -A && git commit -m "local state before 0.10.0"
# unzip aeroos-0.10.0-update.zip over the folder (replace files) — it contains only the files below
git status && git diff          # keep a local fix with:  git checkout -p -- <file>
docker compose up -d --build    # migration 0022 + demo seed 9008 run automatically
scripts/smoke.sh                # reports AeroOS 0.10.0 and checks the new areas
scripts/verify-all.sh           # writes verify-report.txt — send it to me
```
Needs 0.9.0 applied first. No dependency changed; your `pnpm-lock.yaml` still matches.

## New
- **Quality → Safety Reports (SMS):** anyone reports (optionally confidential); ICAO 5×5 risk matrix; 72-hour
  mandatory reporting to the authority; investigation; closure with residual risk.
- **Quality → Audits & Findings:** audit programme, findings by level with due dates, root cause, closure rules.
- **Quality → Corrective Actions:** owners complete with evidence; the quality manager verifies effectiveness.
- **AMO → Non-conforming Parts & Scrap:** quarantine (free stock only), disposition, witnessed mutilation;
  scrapped serials are recorded in the component history and can never be installed again.
- **Signing gate:** certifying staff must have acknowledged the current exposition (and procedures flagged as
  required) before stamping or issuing a CRS. In the demo, `k.mwangi` reads **MOE revision 2** first.

## Behaviour change to know
After this update `k.mwangi` is refused on task cards until MOE revision 2 is acknowledged — the card says
exactly what to read. That is the rule working, not a fault.

## Files (A = added, M = modified)
- A `apps/api/db/migrations/0022_safety_quality_ncr.sql`, `apps/api/db/seeds/9008_safety_quality.sql`
- A `apps/api/src/modules/org/safety-quality.service.ts`; M `org.module.ts`, `org.repository.ts`, `org.tables.ts`, `document-control.service.ts`
- A `apps/api/src/modules/amo/nonconformity.service.ts`; M `amo.module.ts`
- M `apps/api/src/modules/camo/camo.module.ts`, `components.service.ts`
- M `apps/api/src/platform/authz/authz.service.ts`, `apps/api/src/platform/storage/documents.service.ts`
- A `apps/web/src/features/quality/Safety.tsx`, `Audits.tsx`, `ActionsPanel.tsx`, `apps/web/src/features/stores/Ncr.tsx`; M `apps/web/src/app/router.tsx`, `Shell.tsx`
- A `packages/org-domain/src/safety.ts`, `safety.test.ts`; M `index.ts`
- A `packages/mro-domain/src/nonconformity.ts`, `nonconformity.test.ts`; M `component.ts`, `index.ts`
- M `packages/contracts/src/index.ts`
- A `infra/cerbos/policies/occurrence.yaml`, `quality_audit.yaml`, `corrective_action.yaml`, `nonconformity.yaml`, `tests/safety_quality_test.yaml`; M `document.yaml`
- A `e2e/tests/safety.spec.ts`; M `e2e/tests/helpers.ts`, `journey.spec.ts`; M `scripts/smoke.sh`
- A `docs/adr/0020-safety-quality-ncr.md`; M `docs/delivery-plan.md`, `README.md`, this file
- M version 0.10.0: `package.json`, `apps/{api,web,worker}/package.json`, `packages/*/package.json`, `e2e/package.json`, `apps/worker/src/otel.ts`, `deploy/helm/aeroos/Chart.yaml`, `values.yaml`

No files deleted.
